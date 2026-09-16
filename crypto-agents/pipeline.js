const config = require('./config');
const binance = require('./binanceClient');
const { momentumResearch, volumeResearch } = require('./team/researchers');
const { discuss } = require('./team/discussion');
const { sizePosition, checkExposure } = require('./team/portfolio');
const generalManager = require('./team/generalManager');
const executor = require('./executor');
const riskGuard = require('./riskGuard');

// Runs one volume-surging coin through the full team: Research -> Discussion
// -> Portfolio Management -> General Manager -> Executor. Returns a full
// trace of every agent's output so the dashboard can show real reasoning,
// not a canned animation, mirroring the existing trading-agents-service
// job trace shape.
async function runForSymbol(surge, state) {
  const cooldownCheck = riskGuard.checkSymbolCooldown(state, surge.symbol);
  if (!cooldownCheck.ok) {
    return { symbol: surge.symbol, decision: { action: 'hold', reasoning: cooldownCheck.reason } };
  }

  const klines = await binance.getKlines(surge.symbol, '1m', 60);
  const researchA = momentumResearch(klines);
  const researchB = volumeResearch(klines);
  const discussion = discuss({ researchA, researchB, surge, klines });

  const filters = binance.getSymbolFilters(surge.symbol);
  const quoteAsset = filters ? filters.quoteAsset : config.QUOTE_ASSET;
  const freeBalance = config.LIVE_TRADING_ENABLED && config.BINANCE_API_KEY
    ? await binance.getFreeBalance(quoteAsset).catch(() => 0)
    : (state.dayStartBalance || 1000); // paper-mode assumed balance for sizing math

  const positionSizing = discussion.proceed
    ? sizePosition(surge.symbol, surge.lastPrice, freeBalance)
    : { agent: 'Position Sizer', approved: false, reason: 'Not evaluated — Discussion Team already said hold.' };

  const exposure = checkExposure(state, surge.symbol, freeBalance);

  const decision = generalManager.finalize({ symbol: surge.symbol, surge, discussion, positionSizing, exposure });

  const trace = { symbol: surge.symbol, surge, researchA, researchB, discussion, positionSizing, exposure, decision };

  if (decision.action !== 'buy') {
    return trace;
  }

  const executed = await executor.executePlan(decision);
  riskGuard.recordOpen(state, surge.symbol, executed);
  trace.executed = executed;
  return trace;
}

module.exports = { runForSymbol };
