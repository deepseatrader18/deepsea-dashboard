const config = require('./config');
const binance = require('./binanceClient');
const futuresClient = require('./futuresClient');
const scanner = require('./scanner');
const WsScanner = require('./wsScanner');
const pipeline = require('./pipeline');
const monitor = require('./monitor');
const riskGuard = require('./riskGuard');
const reporter = require('./reporter');
const telegram = require('./telegram');
const balanceCache = require('./balanceCache');
const stateStore = require('./state');
const marketFilter = require('./marketFilter');

// The Crypto Team's main loop — meant to run on the owner's own VPS/laptop,
// NOT on Render (Binance returns 451/403 to US-hosted datacenter IPs,
// which is why this whole folder is separate from the Render-hosted
// dashboard). See README.md for setup.
//
// Architecture is event-driven, not polled, because speed was an explicit
// requirement: a volume surge is a fast-moving signal, and every second
// spent waiting for the next poll is a second of slippage risk.
//   - wsScanner.js holds a live Binance WebSocket connection and emits a
//     'surge' event within ~1s of a real volume jump — handleSurge() below
//     reacts immediately, no polling delay.
//   - A separate fast interval (POSITION_TICK_MS) only handles bookkeeping:
//     checking open positions for their exit and reporting status. The
//     actual take-profit/stop-loss already lives on Binance's own matching
//     engine as an OCO order and fires the instant price crosses it,
//     completely independent of this interval's speed.

let state = stateStore.load();
const recentDecisions = []; // last few full team traces, for the dashboard
const recentSurges = []; // last few raw surge detections, even ones skipped (cooldown/max-trades) — shows the scanner is actually finding things
const processing = new Set(); // symbols currently mid-pipeline, to avoid double-firing on a burst of WS ticks

function pushRecentDecision(trace) {
  recentDecisions.unshift({ ...trace, at: Date.now() });
  if (recentDecisions.length > 8) recentDecisions.pop();
}

function pushRecentSurge(surge) {
  recentSurges.unshift({ symbol: surge.symbol, surgeMultiple: surge.surgeMultiple, priceChangePct: surge.priceChangePct, at: Date.now() });
  if (recentSurges.length > 10) recentSurges.pop();
}

async function handleSurge(surge) {
  pushRecentSurge(surge);
  if (processing.has(surge.symbol)) return; // already being evaluated from an earlier tick this same burst
  const openCount = Object.keys(state.openPositions).length;
  if (config.MAX_CONCURRENT_TRADES > 0 && openCount >= config.MAX_CONCURRENT_TRADES) return;
  if (!riskGuard.checkSymbolCooldown(state, surge.symbol).ok) return;

  processing.add(surge.symbol);
  try {
    const trace = await pipeline.runForSymbol(surge, state);
    pushRecentDecision(trace);
    if (trace.decision.action === 'long' || trace.decision.action === 'short') {
      console.log(`ENTERED ${trace.symbol} ${trace.decision.action.toUpperCase()} (${trace.executed.mode}): ${trace.decision.reasoning}`);
      telegram.sendTelegramMessage(telegram.formatTradeOpen(trace.executed));
      stateStore.save(state); // only a 'buy' actually changes persisted state (openPositions) — a 'hold' has nothing new to save
    }
  } catch (err) {
    console.error(`Pipeline failed for ${surge.symbol}:`, err.message);
  } finally {
    processing.delete(surge.symbol);
  }
}

async function housekeepingTick(wsScanner) {
  const latestPrices = wsScanner.getLatestPrices();

  let freeBalance;
  try {
    freeBalance = await balanceCache.getFreeBalance(state);
  } catch (err) {
    console.error('Balance check failed:', err.message);
    freeBalance = stateStore.ensurePaperBalance(state);
  }
  stateStore.rolloverDayIfNeeded(state, freeBalance);

  const closedTrades = await monitor.checkOpenPositions(state, latestPrices);
  if (closedTrades.length) {
    // Read once after all of this tick's closes are recorded, so every
    // message reports the account state as of right now, not mid-update.
    const totalCapital = await balanceCache.getFreeBalance(state).catch(() => null);
    for (const trade of closedTrades) {
      console.log(`Closed ${trade.symbol}: ${trade.outcome} pnl=${trade.pnlQuote.toFixed(2)} ${config.QUOTE_ASSET}`);
      reporter.reportTrade(trade);
      telegram.sendTelegramMessage(telegram.formatTradeClose(trade, { totalCapital, totalProfit: state.totalRealizedPnl }));
    }
  }

  if (closedTrades.length) stateStore.save(state);

  reporter.reportStatus({
    live: config.LIVE_TRADING_ENABLED,
    quoteAsset: config.QUOTE_ASSET,
    freeBalance,
    dayStartBalance: state.dayStartBalance,
    realizedPnlToday: state.realizedPnlToday,
    totalRealizedPnl: state.totalRealizedPnl || 0,
    paperStartingBalance: config.PAPER_STARTING_BALANCE,
    openPositions: state.openPositions,
    wsConnected: wsScanner.connected,
    scannedCount: Object.keys(wsScanner.getLatestPrices()).length,
    recentSurges,
    recentDecisions,
    updatedAt: Date.now()
  });
}

// REST fallback loop — only runs when WS_SCANNER_ENABLED=false. Slower
// (one poll per SCAN_INTERVAL_MS across the whole exchange) but useful if
// a network/firewall blocks outbound WebSocket connections on a given VPS.
const restLatestPrices = {};
async function restScanTick() {
  const allTickers = await binance.getAllTickers24hr().catch(err => {
    console.error('Ticker fetch failed:', err.message);
    return [];
  });
  for (const t of allTickers) restLatestPrices[t.symbol] = parseFloat(t.lastPrice);
  const surges = await scanner.scanOnce(allTickers).catch(err => {
    console.error('Scan failed:', err.message);
    return [];
  });
  const openCount = Object.keys(state.openPositions).length;
  const slotsFree = config.MAX_CONCURRENT_TRADES > 0 ? config.MAX_CONCURRENT_TRADES - openCount : Infinity;
  const candidates = surges.filter(s => riskGuard.checkSymbolCooldown(state, s.symbol).ok).slice(0, Math.max(slotsFree, 0));
  for (const surge of candidates) await handleSurge(surge);
}

async function main() {
  console.log('DeepSea Crypto Team starting...');
  if (config.LIVE_TRADING_ENABLED) {
    console.log('Mode: LIVE — real orders will be placed on Binance with real money.');
  } else {
    console.log(`Mode: PAPER TRADING — no real orders will be placed. Simulated balance: ${config.PAPER_STARTING_BALANCE} ${config.QUOTE_ASSET}.`);
    console.log('Run this for a while, check /crypto on the dashboard (or the trade log below) for win rate and P/L, then set LIVE_TRADING_ENABLED=true once you are happy with the results.');
  }

  // Trading itself happens on Futures (long AND short); Spot is only used
  // for the WS volume scanner's broader coin coverage — see pipeline.js.
  await futuresClient.syncServerTime();
  await futuresClient.loadExchangeInfo();

  // Refresh exchangeInfo periodically — symbols get added/delisted and
  // filters occasionally change; stale filters would round orders wrong.
  setInterval(() => futuresClient.loadExchangeInfo().catch(err => console.error('Futures exchangeInfo refresh failed:', err.message)), 6 * 60 * 60 * 1000);

  // Broad market regime (BTC trend) — refreshed in the background, not on
  // the hot per-trade path, since it changes far slower than any single
  // coin's volume surge. See marketFilter.js / team/discussion.js.
  await marketFilter.refreshBtcTrend();
  setInterval(() => marketFilter.refreshBtcTrend(), 60_000);

  // Correct the in-memory live balance for fee drift periodically — never
  // on the hot trading path itself (see balanceCache.js).
  if (config.LIVE_TRADING_ENABLED && config.BINANCE_API_KEY) {
    setInterval(() => balanceCache.resyncLiveBalance().catch(err => console.error('Balance resync failed:', err.message)), config.BALANCE_RESYNC_MS);
  }

  if (config.WS_SCANNER_ENABLED) {
    console.log('Starting WebSocket scanner (real-time, all Binance pairs)...');
    const wsScanner = new WsScanner();
    wsScanner.on('surge', (surge) => { handleSurge(surge); });
    setInterval(() => housekeepingTick(wsScanner).catch(err => console.error('Housekeeping tick failed:', err.message)), config.POSITION_TICK_MS);
  } else {
    console.log('WS_SCANNER_ENABLED=false — falling back to slower REST polling every', config.SCAN_INTERVAL_MS / 1000, 'seconds.');
    const fakeWsScanner = { getLatestPrices: () => restLatestPrices, connected: false };
    setInterval(() => housekeepingTick(fakeWsScanner).catch(err => console.error('Housekeeping tick failed:', err.message)), config.POSITION_TICK_MS);
    await restScanTick().catch(err => console.error('Scan tick failed:', err.message));
    setInterval(() => restScanTick().catch(err => console.error('Scan tick failed:', err.message)), config.SCAN_INTERVAL_MS);
  }
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
