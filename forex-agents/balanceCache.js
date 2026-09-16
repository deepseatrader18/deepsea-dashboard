const config = require('./config');
const oandaClient = require('./oandaClient');
const stateStore = require('./state');

// Keeps the free (margin-available) balance in memory instead of making an
// OANDA REST call on every single trade decision — same reasoning as
// crypto-agents/balanceCache.js. Updated instantly and locally right when
// a trade opens/closes, only re-synced against the real account
// occasionally to correct for drift.
let liveBalance = null;

async function ensureLiveBalance() {
  if (liveBalance === null) {
    const summary = await oandaClient.getAccountSummary();
    liveBalance = summary.marginAvailable;
  }
  return liveBalance;
}

async function resyncLiveBalance() {
  const summary = await oandaClient.getAccountSummary();
  liveBalance = summary.marginAvailable;
  return liveBalance;
}

function adjustLiveBalance(deltaQuote) {
  if (liveBalance !== null) liveBalance += deltaQuote;
}

async function getFreeBalance(state) {
  if (config.LIVE_TRADING_ENABLED && config.OANDA_API_TOKEN && config.OANDA_ACCOUNT_ID) {
    return ensureLiveBalance();
  }
  return stateStore.ensurePaperBalance(state);
}

module.exports = { getFreeBalance, adjustLiveBalance, resyncLiveBalance };
