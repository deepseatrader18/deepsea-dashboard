const config = require('./config');

// The one place that is allowed to say "no" for account-safety reasons —
// independent of whatever the team's analysis concluded. Even a unanimous
// BUY from the researchers/discussion/portfolio agents is blocked here if
// it would break the account's own risk policy.
function checkGlobalLimits(state, currentBalance) {
  const openCount = Object.keys(state.openPositions).length;
  if (openCount >= config.MAX_CONCURRENT_TRADES) {
    return { ok: false, reason: `Max concurrent trades reached (${openCount}/${config.MAX_CONCURRENT_TRADES})` };
  }

  if (state.dayStartBalance) {
    const lossPct = (-state.realizedPnlToday / state.dayStartBalance) * 100;
    if (lossPct >= config.DAILY_LOSS_CAP_PCT) {
      return { ok: false, reason: `Daily loss cap hit (${lossPct.toFixed(2)}% >= ${config.DAILY_LOSS_CAP_PCT}%) — no new entries until tomorrow` };
    }
  }

  if (!(currentBalance > 0)) {
    return { ok: false, reason: 'No free quote balance available' };
  }

  return { ok: true };
}

function checkSymbolCooldown(state, symbol) {
  const until = state.cooldowns[symbol];
  if (until && Date.now() < until) {
    const minsLeft = Math.ceil((until - Date.now()) / 60000);
    return { ok: false, reason: `${symbol} on cooldown for ${minsLeft} more min` };
  }
  if (state.openPositions[symbol]) {
    return { ok: false, reason: `${symbol} already has an open position` };
  }
  return { ok: true };
}

function setSymbolCooldown(state, symbol) {
  state.cooldowns[symbol] = Date.now() + config.SYMBOL_COOLDOWN_MIN * 60 * 1000;
}

function recordOpen(state, symbol, position) {
  state.openPositions[symbol] = position;
}

function recordClose(state, symbol, closedTrade) {
  delete state.openPositions[symbol];
  state.realizedPnlToday += closedTrade.pnlQuote;
  state.totalRealizedPnl = (state.totalRealizedPnl || 0) + closedTrade.pnlQuote;
  // Live trades' balance always comes straight from Binance, so there's
  // nothing to carry forward here — only paper equity needs its own ledger.
  if (closedTrade.mode !== 'live') {
    state.paperBalance = (state.paperBalance ?? config.PAPER_STARTING_BALANCE) + closedTrade.pnlQuote;
  }
  state.trades.push(closedTrade);
  if (state.trades.length > 500) state.trades = state.trades.slice(-500);
  setSymbolCooldown(state, symbol);
}

module.exports = { checkGlobalLimits, checkSymbolCooldown, setSymbolCooldown, recordOpen, recordClose };
