const config = require('./config');
const futuresClient = require('./futuresClient');
const stateStore = require('./state');

// Keeps the free Futures-wallet balance in memory instead of making a
// signed Binance REST call on every single trade decision — that
// round-trip (typically 100-300ms) sat directly in the hot path between "a
// surge was just detected" and "the order goes out", which is exactly the
// delay the account owner asked to cut. The cache is updated instantly and
// locally right when a trade opens/closes, and only re-synced against the
// real account occasionally (see BALANCE_RESYNC_MS) to correct for fee
// drift and realized funding payments.
let liveBalance = null;

async function ensureLiveBalance() {
  if (liveBalance === null) {
    liveBalance = await futuresClient.getFreeBalance();
  }
  return liveBalance;
}

async function resyncLiveBalance() {
  liveBalance = await futuresClient.getFreeBalance();
  return liveBalance;
}

function adjustLiveBalance(deltaQuote) {
  if (liveBalance !== null) liveBalance += deltaQuote;
}

// Single entry point the team pipeline uses — returns instantly (no
// network call) once the live cache is warm, or the carried-forward paper
// balance when not trading live.
async function getFreeBalance(state) {
  if (config.LIVE_TRADING_ENABLED && config.BINANCE_API_KEY) {
    return ensureLiveBalance();
  }
  return stateStore.ensurePaperBalance(state);
}

module.exports = { getFreeBalance, adjustLiveBalance, resyncLiveBalance };
