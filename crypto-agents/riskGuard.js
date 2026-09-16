const config = require('./config');

// Total capital (margin) currently committed across every open position —
// the number MAX_TOTAL_EXPOSURE_PCT is measured against, independent of
// how many separate positions that's spread across. Margin, not notional,
// is the actual collateral at stake — leverage lets a small margin
// control a larger notional, but the capital genuinely at risk is the
// margin (bounded further still by the tight stop-loss on that notional).
function calculateOpenExposure(state) {
  return Object.values(state.openPositions).reduce((sum, pos) => sum + (pos.margin ?? pos.qty * pos.entryPrice), 0);
}

// The one place that is allowed to say "no" for account-safety reasons —
// independent of whatever the team's analysis concluded. Even a unanimous
// BUY from the researchers/discussion/portfolio agents is blocked here if
// it would break the account's own risk policy.
function checkGlobalLimits(state, currentBalance) {
  const openCount = Object.keys(state.openPositions).length;
  // MAX_CONCURRENT_TRADES <= 0 means "no cap" — trade on every coin that
  // clears the team's own bar, however many that turns out to be. The real
  // safety net against that is MAX_TOTAL_EXPOSURE_PCT below, not a count.
  if (config.MAX_CONCURRENT_TRADES > 0 && openCount >= config.MAX_CONCURRENT_TRADES) {
    return { ok: false, reason: `Max concurrent trades reached (${openCount}/${config.MAX_CONCURRENT_TRADES})` };
  }

  // Hard ceiling on total capital at risk at once, regardless of how many
  // positions that's spread across — this is what actually keeps the
  // account from being wiped out with an uncapped trade count: however
  // many coins the team finds, never more than this fraction of the
  // account's starting-of-day balance can be committed at the same time.
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
  // Live trades' balance always comes straight from the Futures wallet, so
  // there's nothing to carry forward here — only paper equity needs its
  // own ledger. The margin (not the full notional — Futures, unlike Spot,
  // only ties up the margin) is returned along with the P/L, since the
  // margin was reserved out of paperBalance the moment the trade opened
  // (see pipeline.js) — returning only pnlQuote here would double-count
  // it as still "spent" forever.
  if (closedTrade.mode !== 'live') {
    state.paperBalance = (state.paperBalance ?? config.PAPER_STARTING_BALANCE) + (closedTrade.margin ?? 0) + closedTrade.pnlQuote;
  }
  state.trades.push(closedTrade);
  if (state.trades.length > 500) state.trades = state.trades.slice(-500);
  setSymbolCooldown(state, symbol);
}

module.exports = { checkGlobalLimits, checkSymbolCooldown, setSymbolCooldown, recordOpen, recordClose };
