const binance = require('./binanceClient');
const { momentumResearch, volumeResearch } = require('./team/researchers');
const { discuss } = require('./team/discussion');
const { sizePosition, checkExposure } = require('./team/portfolio');
const generalManager = require('./team/generalManager');
const executor = require('./executor');
const riskGuard = require('./riskGuard');
const balanceCache = require('./balanceCache');
const stateStore = require('./state');

// Runs one volume-surging coin through the full team: Research -> Discussion
// -> Portfolio Management -> General Manager -> Executor. Returns a full
// trace of every agent's output so the dashboard can show real reasoning,
// not a canned animation, mirroring the existing trading-agents-service
// job trace shape.
//
// Speed matters here — a volume surge is a fast-moving signal, and every
// millisecond between detection and the order landing is slippage risk.
// The only network calls in this whole path are one klines fetch and (in
// live mode) the order placement itself in executor.js — balance comes
// from the in-memory cache (balanceCache.js), not a fresh signed request,
// and every research/discussion/sizing step is synchronous in-process math.
async function runForSymbol(surge, state) {
  const cooldownCheck = riskGuard.checkSymbolCooldown(state, surge.symbol);
  if (!cooldownCheck.ok) {
    return { symbol: surge.symbol, decision: { action: 'hold', reasoning: cooldownCheck.reason } };
  }

  const klines = await binance.getKlines(surge.symbol, '1m', 30);
  const researchA = momentumResearch(klines);
  const researchB = volumeResearch(klines);
  const discussion = discuss({ researchA, researchB, surge, klines });

  const freeBalance = await balanceCache.getFreeBalance(state);

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
  if (executed.mode === 'live') {
    balanceCache.adjustLiveBalance(-(executed.qty * executed.entryPrice));
  } else {
    stateStore.adjustPaperBalance(state, -(executed.qty * executed.entryPrice));
  }
  trace.executed = executed;
  return trace;
}

module.exports = { runForSymbol };
