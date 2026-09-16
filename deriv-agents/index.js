const config = require('./config');
const derivClient = require('./derivClient');
const pipeline = require('./pipeline');
const monitor = require('./monitor');
const riskGuard = require('./riskGuard');
const telegram = require('./telegram');
const balanceCache = require('./balanceCache');
const stateStore = require('./state');

// DeepSea Deriv Team's main loop — runs on the owner's own laptop, same
// pattern as crypto-agents/ and forex-agents/, trading every configured
// Deriv pair (config.INSTRUMENTS). Polled per pair, once per newly-closed
// candle, same reasoning as the OANDA team.
const state = stateStore.load();
const processing = new Set();

async function tick() {
  let freeBalance;
  try {
    freeBalance = await balanceCache.getFreeBalance(state);
  } catch (err) {
    console.error('Balance check failed:', err.message);
    freeBalance = stateStore.ensurePaperBalance(state);
  }
  stateStore.rolloverDayIfNeeded(state, freeBalance);

  // 1) Check every open position (across all pairs) for its exit. Deriv has
  // no batched multi-symbol price endpoint the way OANDA does, so paper
  // positions are checked one price fetch at a time.
  const openInstruments = Object.keys(state.openPositions);
  const latestPrices = {};
  for (const instrument of openInstruments) {
    if (state.openPositions[instrument].mode === 'live') continue; // live check reads the contract itself, no price needed
    latestPrices[instrument] = await derivClient.getPrice(instrument).catch(() => null);
  }
  const closedTrades = await monitor.checkOpenPositions(state, latestPrices);
  if (closedTrades.length) {
    const totalCapital = await balanceCache.getFreeBalance(state).catch(() => null);
    for (const trade of closedTrades) {
      console.log(`Closed ${trade.instrument}: ${trade.outcome} pnl=${trade.pnlQuote.toFixed(2)}`);
      if (trade.mode === 'live') {
        balanceCache.adjustLiveBalance(trade.margin + trade.pnlQuote);
      }
      telegram.sendTelegramMessage(telegram.formatTradeClose(trade, { totalCapital, totalProfit: state.totalRealizedPnl }));
    }
    stateStore.save(state);
  }

  // 2) Evaluate every pair that isn't already in a position or cooldown.
  for (const instrument of config.INSTRUMENTS) {
    if (processing.has(instrument)) continue;
    if (!riskGuard.checkCooldown(state, instrument).ok) continue;
    processing.add(instrument);
    try {
      const trace = await pipeline.runCycle(state, instrument);
      if (!trace) continue;
      if (trace.decision.action === 'long' || trace.decision.action === 'short') {
        console.log(`ENTERED ${trace.instrument} ${trace.decision.action.toUpperCase()} (${trace.executed.mode}): ${trace.decision.reasoning}`);
        telegram.sendTelegramMessage(telegram.formatTradeOpen(trace.executed));
        stateStore.save(state);
      } else if (trace.decision) {
        console.log(`Hold: ${trace.decision.reasoning}`);
      }
    } catch (err) {
      console.error(`Pipeline failed for ${instrument}:`, err.message);
    } finally {
      processing.delete(instrument);
    }
  }
  stateStore.save(state);
}

async function main() {
  console.log('DeepSea Deriv Team starting...');
  console.log(`Trading pairs: ${config.INSTRUMENTS.join(', ')}`);
  console.log('NOTE: trading non-INR forex/gold from India via an overseas broker carries real legal risk under RBI/FEMA rules — see forex-agents/README.md and the chat history for details. This was an explicit, informed choice by the account owner.');
  if (config.LIVE_TRADING_ENABLED) {
    console.log('Mode: LIVE — real contracts will be bought on Deriv with real money.');
  } else {
    console.log(`Mode: PAPER TRADING — no real contracts will be bought. Simulated balance: ${config.PAPER_STARTING_BALANCE}.`);
    console.log('Run this for a while, check the trade log below for win rate and P/L, then set LIVE_TRADING_ENABLED=true (with a funded real Deriv account) once you are happy with the results.');
  }

  if (config.LIVE_TRADING_ENABLED && config.DERIV_API_TOKEN) {
    setInterval(() => balanceCache.resyncLiveBalance().catch(err => console.error('Balance resync failed:', err.message)), 2 * 60_000);
  }

  setInterval(() => tick().catch(err => console.error('Tick failed:', err.message)), config.POLL_INTERVAL_MS);
  await tick().catch(err => console.error('Tick failed:', err.message));
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
