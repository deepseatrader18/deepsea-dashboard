const config = require('./config');
const futuresClient = require('./futuresClient');
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
// Trading happens on Binance USDT-M Futures (not Spot) so both long and
// short entries are possible — Spot can only ever sell what it already
// owns. The surge itself is still detected from Spot's WebSocket (broader
// coin coverage); the first thing this does is check whether that symbol
// even has a Futures perpetual at all, since many small-cap Spot-only
// coins don't.
//
// Speed matters here — a volume surge is a fast-moving signal, and every
// millisecond between detection and the order landing is slippage risk.
async function runForSymbol(surge, state) {
  if (!futuresClient.hasSymbol(surge.symbol)) {
    return { symbol: surge.symbol, decision: { action: 'hold', reasoning: `No Binance Futures perpetual for ${surge.symbol} — Spot-only coin, skipped.` } };
  }

  const cooldownCheck = riskGuard.checkSymbolCooldown(state, surge.symbol);
  if (!cooldownCheck.ok) {
    return { symbol: surge.symbol, decision: { action: 'hold', reasoning: cooldownCheck.reason } };
  }

  const klines = await futuresClient.getKlines(surge.symbol, '1m', 30);
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

  if (decision.action !== 'long' && decision.action !== 'short') {
    return trace;
  }

  // Confirm the move hasn't kept accelerating before actually committing
  // capital. Entering the instant a surge is detected means chasing the
  // exact top (for a long) or bottom (for a short) of the spike — real
  // paper-trading results showed that pattern tripping the stop-loss
  // almost every time. A short pause lets a genuine pullback/stabilization
  // show up first.
  if (config.ENTRY_CONFIRM_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, config.ENTRY_CONFIRM_DELAY_MS));
    const confirmPrice = await futuresClient.getPrice(surge.symbol).catch(() => null);
    if (confirmPrice != null) {
      const sign = decision.direction === 'long' ? 1 : -1;
      // "Chasing" means price kept moving further the way we were about to
      // trade — up further for a long, down further for a short.
      const chasePct = sign * ((confirmPrice - decision.entryPrice) / decision.entryPrice) * 100;
      if (chasePct > config.ENTRY_MAX_CHASE_PCT) {
        trace.decision = {
          action: 'hold',
          reasoning: `${decision.reasoning} [SKIPPED after confirmation wait — price kept running (+${chasePct.toFixed(2)}% further over ${config.ENTRY_CONFIRM_DELAY_MS / 1000}s), too risky to chase a still-accelerating move.]`
        };
        return trace;
      }
      // Re-anchor entry/exit levels to the confirmed (post-wait) price
      // rather than the stale surge-detection price.
      decision.entryPrice = confirmPrice;
      decision.tpPrice = Number((confirmPrice * (1 + sign * config.TAKE_PROFIT_PCT / 100)).toPrecision(12));
      decision.slStopPrice = Number((confirmPrice * (1 - sign * config.STOP_LOSS_PCT / 100)).toPrecision(12));
    }
  }

  const executed = await executor.executePlan(decision);
  riskGuard.recordOpen(state, surge.symbol, executed);
  if (executed.mode === 'live') {
    balanceCache.adjustLiveBalance(-executed.margin);
  } else {
    stateStore.adjustPaperBalance(state, -executed.margin);
  }
  trace.executed = executed;
  return trace;
}

module.exports = { runForSymbol };
