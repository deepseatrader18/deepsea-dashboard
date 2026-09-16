const config = require('./config');
const binance = require('./binanceClient');
const scanner = require('./scanner');
const pipeline = require('./pipeline');
const monitor = require('./monitor');
const riskGuard = require('./riskGuard');
const reporter = require('./reporter');
const stateStore = require('./state');

// The Crypto Team's main loop — meant to run on the owner's own VPS/laptop,
// NOT on Render (Binance returns 451/403 to US-hosted datacenter IPs,
// which is why this whole folder is separate from the Render-hosted
// dashboard). See README.md for setup.
//
// Every tick: scan all <QUOTE_ASSET> pairs on Binance for a real volume
// surge -> run the strongest candidate through the full team (Research ->
// Discussion -> Portfolio Management -> General Manager) -> execute (or
// paper-log) the approved plan -> check existing open positions for their
// exit -> report a status snapshot to the dashboard.

let state = stateStore.load();
const recentDecisions = []; // last few full team traces, for the dashboard

function pushRecentDecision(trace) {
  recentDecisions.unshift({ ...trace, at: Date.now() });
  if (recentDecisions.length > 8) recentDecisions.pop();
}

async function tick() {
  const allTickers = await binance.getAllTickers24hr().catch(err => {
    console.error('Ticker fetch failed:', err.message);
    return [];
  });

  const latestPrices = {};
  for (const t of allTickers) latestPrices[t.symbol] = parseFloat(t.lastPrice);

  const surges = await scanner.scanOnce(allTickers).catch(err => {
    console.error('Scan failed:', err.message);
    return [];
  });

  let freeBalance = 0;
  try {
    freeBalance = config.BINANCE_API_KEY
      ? await binance.getFreeBalance(config.QUOTE_ASSET)
      : (state.dayStartBalance || 1000);
  } catch (err) {
    console.error('Balance check failed:', err.message);
    freeBalance = state.dayStartBalance || 0;
  }
  stateStore.rolloverDayIfNeeded(state, freeBalance);

  const closedTrades = await monitor.checkOpenPositions(state, latestPrices);
  for (const trade of closedTrades) {
    console.log(`Closed ${trade.symbol}: ${trade.outcome} pnl=${trade.pnlQuote.toFixed(2)} ${config.QUOTE_ASSET}`);
    reporter.reportTrade(trade);
  }

  const openCount = Object.keys(state.openPositions).length;
  const slotsFree = config.MAX_CONCURRENT_TRADES - openCount;

  const candidates = surges.filter(s => riskGuard.checkSymbolCooldown(state, s.symbol).ok).slice(0, Math.max(slotsFree, 0));

  for (const surge of candidates) {
    try {
      const trace = await pipeline.runForSymbol(surge, state);
      pushRecentDecision(trace);
      if (trace.decision.action === 'buy') {
        console.log(`ENTERED ${trace.symbol} (${trace.executed.mode}): ${trace.decision.reasoning}`);
      }
    } catch (err) {
      console.error(`Pipeline failed for ${surge.symbol}:`, err.message);
    }
  }

  stateStore.save(state);

  reporter.reportStatus({
    live: config.LIVE_TRADING_ENABLED,
    quoteAsset: config.QUOTE_ASSET,
    freeBalance,
    dayStartBalance: state.dayStartBalance,
    realizedPnlToday: state.realizedPnlToday,
    openPositions: state.openPositions,
    scannedCount: allTickers.length,
    topSurges: surges.slice(0, 5).map(s => ({ symbol: s.symbol, surgeMultiple: s.surgeMultiple, priceChangePct: s.priceChangePct })),
    recentDecisions,
    updatedAt: Date.now()
  });
}

async function main() {
  console.log('DeepSea Crypto Team starting...');
  console.log(`Mode: ${config.LIVE_TRADING_ENABLED ? 'LIVE (real orders will be placed)' : 'PAPER (no real orders — set LIVE_TRADING_ENABLED=true to go live)'}`);

  await binance.syncServerTime();
  await binance.loadExchangeInfo();
  console.log('Exchange info loaded. Scanning every', config.SCAN_INTERVAL_MS / 1000, 'seconds.');

  // Refresh exchangeInfo periodically — symbols get added/delisted and
  // filters occasionally change; stale filters would round orders wrong.
  setInterval(() => binance.loadExchangeInfo().catch(err => console.error('exchangeInfo refresh failed:', err.message)), 6 * 60 * 60 * 1000);

  await tick().catch(err => console.error('Tick failed:', err.message));
  setInterval(() => tick().catch(err => console.error('Tick failed:', err.message)), config.SCAN_INTERVAL_MS);
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
