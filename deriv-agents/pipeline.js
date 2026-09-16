const config = require('./config');
const derivClient = require('./derivClient');
const { momentumResearch, rangeResearch } = require('./team/researchers');
const { discuss } = require('./team/discussion');
const { sizePosition, checkExposure } = require('./team/portfolio');
const generalManager = require('./team/generalManager');
const executor = require('./executor');
const riskGuard = require('./riskGuard');
const balanceCache = require('./balanceCache');
const stateStore = require('./state');

// Runs one evaluation cycle for a single Deriv pair — same structure as
// forex-agents/pipeline.js: Research -> Discussion -> Portfolio Management
// -> General Manager -> Executor, once per newly-closed candle per pair.
async function runCycle(state, instrument) {
  const cooldown = riskGuard.checkCooldown(state, instrument);
  if (!cooldown.ok) {
    return null;
  }

  const candles = await derivClient.getCandles(instrument, config.CANDLE_GRANULARITY_SEC, config.CANDLE_COUNT);
  if (candles.length < 21) {
    return { instrument, decision: { action: 'hold', reasoning: `${instrument}: not enough candle history yet.` } };
  }

  const latestCandleTime = candles[candles.length - 1].time;
  if (latestCandleTime === state.lastSignalCandleTimes[instrument]) {
    return null;
  }
  state.lastSignalCandleTimes[instrument] = latestCandleTime;

  const researchA = momentumResearch(candles);
  const researchB = rangeResearch(candles);
  const discussion = discuss({ researchA, researchB, candles });

  const trace = { instrument, researchA, researchB, discussion };

  if (!discussion.proceed) {
    trace.decision = { action: 'hold', reasoning: discussion.reasoning };
    return trace;
  }

  const freshPrice = await derivClient.getPrice(instrument);
  const freeBalance = await balanceCache.getFreeBalance(state);
  const positionSizing = sizePosition(instrument, freshPrice, freeBalance);
  const exposure = checkExposure(state, instrument, freeBalance);
  const decision = generalManager.finalize({ instrument, entryPrice: freshPrice, discussion, positionSizing, exposure });
  trace.decision = decision;

  if (decision.action !== 'long' && decision.action !== 'short') {
    return trace;
  }

  const executed = await executor.executePlan(decision);
  riskGuard.recordOpen(state, instrument, executed);
  if (executed.mode === 'live') {
    balanceCache.adjustLiveBalance(-executed.margin);
  } else {
    stateStore.adjustPaperBalance(state, -executed.margin);
  }
  trace.executed = executed;
  return trace;
}

module.exports = { runCycle };
