const config = require('./config');
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

  const klines = await binance.getKlines(surge.symbol, config.KLINE_INTERVAL, 30);
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

  // Confirm the move hasn't kept accelerating before actually committing
  // capital. Buying the instant a surge is detected means buying the exact
  // top of the spike — real paper-trading results showed that pattern
  // tripping the stop-loss almost every time. A short pause lets a genuine
  // pullback/stabilization show up first.
  if (config.ENTRY_CONFIRM_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, config.ENTRY_CONFIRM_DELAY_MS));
    const confirmPrice = await binance.getPrice(surge.symbol).catch(() => null);
    if (confirmPrice != null) {
      const chasePct = ((confirmPrice - decision.entryPrice) / decision.entryPrice) * 100;
      if (chasePct > config.ENTRY_MAX_CHASE_PCT) {
        trace.decision = {
          action: 'hold',
          reasoning: `${decision.reasoning} [SKIPPED after confirmation wait — price kept running (+${chasePct.toFixed(2)}% further over ${config.ENTRY_CONFIRM_DELAY_MS / 1000}s), too risky to chase a still-accelerating spike.]`
        };
        return trace;
      }
      // Re-anchor entry/exit levels to the confirmed (post-wait) price
      // rather than the stale surge-detection price.
      decision.entryPrice = confirmPrice;
      decision.tpPrice = Number((confirmPrice * (1 + config.TAKE_PROFIT_PCT / 100)).toPrecision(12));
      decision.slStopPrice = Number((confirmPrice * (1 - config.STOP_LOSS_PCT / 100)).toPrecision(12));
      decision.slLimitPrice = Number((decision.slStopPrice * 0.998).toPrecision(12));
    }
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
