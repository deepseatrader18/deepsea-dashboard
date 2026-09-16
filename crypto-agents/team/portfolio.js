const config = require('../config');
const futuresClient = require('../futuresClient');
const riskGuard = require('../riskGuard');

// Portfolio Management: two agents, each with veto power over the trade
// the Discussion Team already agreed on. Neither one cares whether the
// signal looks good — only whether taking it is safe for the account.

// Position Sizer: PER_TRADE_RISK_PCT of free balance is committed as
// MARGIN (the actual collateral at stake) — leverage then determines how
// much notional exposure that margin controls, not the other way round.
// This keeps the same "1% of capital per trade" intuition Spot sizing
// always had; leverage only amplifies both the position and, if the
// tight stop-loss is ever gapped through, the loss — see
// config.GAP_PROTECTION_BUFFER_PCT and monitor.js for that edge case.
function sizePosition(symbol, price, freeQuoteBalance) {
  const filters = futuresClient.getSymbolFilters(symbol);
  if (!filters) {
    return { agent: 'Position Sizer', approved: false, reason: `No Futures market found for ${symbol} — skipping (not every Spot coin has a Futures perpetual).` };
  }

  const margin = freeQuoteBalance * (config.PER_TRADE_RISK_PCT / 100);
  const notional = margin * config.FUTURES_LEVERAGE;
  if (notional < filters.minNotional) {
    return {
      agent: 'Position Sizer',
      approved: false,
      reason: `Position size $${notional.toFixed(2)} (${config.FUTURES_LEVERAGE}x on $${margin.toFixed(2)} margin) is below the exchange minimum notional ($${filters.minNotional}) for ${symbol}`
    };
  }

  const rawQty = notional / price;
  const qty = futuresClient.roundStep(rawQty, filters.stepSize);
  if (!qty || qty < (filters.minQty || 0)) {
    return { agent: 'Position Sizer', approved: false, reason: `Rounded quantity too small to trade for ${symbol}` };
  }

  return {
    agent: 'Position Sizer',
    approved: true,
    margin: Number(margin.toFixed(2)),
    quoteAmount: Number((qty * price).toFixed(2)), // actual notional after rounding
    qty,
    reason: `Sizing ${symbol} with $${margin.toFixed(2)} margin (${config.PER_TRADE_RISK_PCT}% of free balance) at ${config.FUTURES_LEVERAGE}x leverage ≈ $${(qty * price).toFixed(2)} notional.`
  };
}

// Exposure Guard: the account-level checks (concurrent trades, total
// exposure cap, daily loss cap, per-symbol cooldown) — independent of
// this specific trade's own merits.
function checkExposure(state, symbol, freeQuoteBalance) {
  const global = riskGuard.checkGlobalLimits(state, freeQuoteBalance);
  if (!global.ok) return { agent: 'Exposure Guard', approved: false, reason: global.reason };

  const cooldown = riskGuard.checkSymbolCooldown(state, symbol);
  if (!cooldown.ok) return { agent: 'Exposure Guard', approved: false, reason: cooldown.reason };

  return { agent: 'Exposure Guard', approved: true, reason: 'Within daily loss cap, total exposure cap, concurrent-trade limit, and symbol cooldown.' };
}

module.exports = { sizePosition, checkExposure };
