const config = require('./config');
const oandaClient = require('./oandaClient');
const pipeline = require('./pipeline');
const monitor = require('./monitor');
const riskGuard = require('./riskGuard');
const telegram = require('./telegram');
const balanceCache = require('./balanceCache');
const stateStore = require('./state');

// DeepSea Forex Team's main loop — runs on the owner's own laptop, same as
// crypto-agents/, trading every configured OANDA pair (config.INSTRUMENTS).
// Polled, not event-driven: forex majors don't have the "volume surge on a
// thin altcoin" pattern crypto's WS scanner watches for, so a periodic
// per-pair candle check is the right speed here.
const state = stateStore.load();
const processing = new Set(); // instruments currently mid-pipeline this tick

async function tick() {
  let freeBalance;
  try {
    freeBalance = await balanceCache.getFreeBalance(state);
  } catch (err) {
    console.error('Balance check failed:', err.message);
    freeBalance = stateStore.ensurePaperBalance(state);
  }
  stateStore.rolloverDayIfNeeded(state, freeBalance);

  // 1) Check every open position (across all pairs) for its exit. One
  // batched price fetch covers every pair's paper-mode check; live
  // positions are checked against OANDA's own trade state directly.
  const latestPrices = await oandaClient.getPrices(config.INSTRUMENTS).catch(err => {
    console.error('Price fetch failed:', err.message);
    return {};
  });
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

  // 2) Evaluate every pair that isn't already in a position or cooldown for
  // a fresh entry signal. Sequential, not parallel, to stay well within
  // OANDA's rate limits even with a long instrument list.
  for (const instrument of config.INSTRUMENTS) {
    if (processing.has(instrument)) continue;
    if (!riskGuard.checkCooldown(state, instrument).ok) continue;
    processing.add(instrument);
    try {
      const trace = await pipeline.runCycle(state, instrument);
      if (!trace) continue; // same candle already evaluated, or on cooldown
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
  stateStore.save(state); // persists lastSignalCandleTimes even on an all-hold tick
}

async function main() {
  console.log('DeepSea Forex Team starting...');
  console.log(`Trading pairs: ${config.INSTRUMENTS.join(', ')}`);
  if (config.LIVE_TRADING_ENABLED) {
    console.log(`Mode: LIVE (${config.OANDA_ENVIRONMENT}) — real orders will be placed on OANDA with real money.`);
  } else {
    console.log(`Mode: PAPER TRADING (reading ${config.OANDA_ENVIRONMENT} prices) — no real orders will be placed. Simulated balance: ${config.PAPER_STARTING_BALANCE}.`);
    console.log('Run this for a while, check the trade log below for win rate and P/L, then set LIVE_TRADING_ENABLED=true (and OANDA_ENVIRONMENT=live with a funded account) once you are happy with the results.');
  }

  if (config.LIVE_TRADING_ENABLED && config.OANDA_API_TOKEN) {
    setInterval(() => balanceCache.resyncLiveBalance().catch(err => console.error('Balance resync failed:', err.message)), 2 * 60_000);
  }

  setInterval(() => tick().catch(err => console.error('Tick failed:', err.message)), config.POLL_INTERVAL_MS);
  await tick().catch(err => console.error('Tick failed:', err.message));
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
