const config = require('./config');

// Total margin currently committed across every open position, across all
// pairs — what MAX_TOTAL_EXPOSURE_PCT is measured against.
function calculateOpenExposure(state) {
  return Object.values(state.openPositions).reduce((sum, pos) => sum + (pos.margin || 0), 0);
}

// The one place allowed to say "no" for account-safety reasons, independent
// of any single pair's own analysis — mirrors crypto-agents/riskGuard.js.
function checkGlobalLimits(state, currentBalance) {
  const openCount = Object.keys(state.openPositions).length;
  if (config.MAX_CONCURRENT_TRADES > 0 && openCount >= config.MAX_CONCURRENT_TRADES) {
    return { ok: false, reason: `Max concurrent trades reached (${openCount}/${config.MAX_CONCURRENT_TRADES})` };
  }

  const referenceBalance = state.dayStartBalance || config.PAPER_STARTING_BALANCE;
  if (config.MAX_TOTAL_EXPOSURE_PCT > 0 && referenceBalance > 0) {
    const openExposure = calculateOpenExposure(state);
    const exposurePct = (openExposure / referenceBalance) * 100;
    if (exposurePct >= config.MAX_TOTAL_EXPOSURE_PCT) {
      return { ok: false, reason: `Total capital at risk across open positions is ${exposurePct.toFixed(1)}% (cap ${config.MAX_TOTAL_EXPOSURE_PCT}%) — no new entries until one closes` };
    }
  }

  if (state.dayStartBalance) {
    const lossPct = (-state.realizedPnlToday / state.dayStartBalance) * 100;
    if (lossPct >= config.DAILY_LOSS_CAP_PCT) {
      return { ok: false, reason: `Daily loss cap hit (${lossPct.toFixed(2)}% >= ${config.DAILY_LOSS_CAP_PCT}%) — no new entries until tomorrow` };
    }
  }

  if (!(currentBalance > 0)) {
    return { ok: false, reason: 'No free balance available' };
  }

  return { ok: true };
}

function checkCooldown(state, instrument) {
  if (state.openPositions[instrument]) {
    return { ok: false, reason: `${instrument} already has an open position` };
  }
  const until = state.cooldowns[instrument];
  if (until && Date.now() < until) {
    const minsLeft = Math.ceil((until - Date.now()) / 60000);
    return { ok: false, reason: `${instrument} on cooldown for ${minsLeft} more min` };
  }
  return { ok: true };
}

function setCooldown(state, instrument) {
  state.cooldowns[instrument] = Date.now() + config.TRADE_COOLDOWN_MIN * 60 * 1000;
}

function recordOpen(state, instrument, position) {
  state.openPositions[instrument] = position;
}

function recordClose(state, instrument, closedTrade) {
  delete state.openPositions[instrument];
  state.realizedPnlToday += closedTrade.pnlQuote;
  state.totalRealizedPnl = (state.totalRealizedPnl || 0) + closedTrade.pnlQuote;
  if (closedTrade.mode !== 'live') {
    state.paperBalance = (state.paperBalance ?? config.PAPER_STARTING_BALANCE) + (closedTrade.margin ?? 0) + closedTrade.pnlQuote;
  }
  state.trades.push(closedTrade);
  if (state.trades.length > 500) state.trades = state.trades.slice(-500);
  setCooldown(state, instrument);
}

module.exports = { checkGlobalLimits, checkCooldown, recordOpen, recordClose };
