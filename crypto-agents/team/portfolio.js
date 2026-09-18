const config = require('../config');
const binance = require('../binanceClient');
const riskGuard = require('../riskGuard');

// Portfolio Management: two agents, each with veto power over the trade
// the Discussion Team already agreed on. Neither one cares whether the
// signal looks good — only whether taking it is safe for the account.

// Position Sizer: how much capital, respecting the conservative per-trade
// risk % and the exchange's own quantity/notional rules.
function sizePosition(symbol, price, freeQuoteBalance) {
  const filters = binance.getSymbolFilters(symbol);
  if (!filters) {
    return { agent: 'Position Sizer', approved: false, reason: `No exchange filters found for ${symbol}` };
  }

  const targetQuote = freeQuoteBalance * (config.PER_TRADE_RISK_PCT / 100);
  if (targetQuote < filters.minNotional) {
    return {
      agent: 'Position Sizer',
      approved: false,
      reason: `Position size $${targetQuote.toFixed(2)} is below the exchange minimum notional ($${filters.minNotional}) for ${symbol}`
    };
  }

  const rawQty = targetQuote / price;
  const qty = binance.roundStep(rawQty, filters.stepSize);
  if (!qty || qty < (filters.minQty || 0)) {
    return { agent: 'Position Sizer', approved: false, reason: `Rounded quantity too small to trade for ${symbol}` };
  }

  return {
    agent: 'Position Sizer',
    approved: true,
    quoteAmount: Number((qty * price).toFixed(2)),
    qty,
    reason: `Sizing ${symbol} at ${config.PER_TRADE_RISK_PCT}% of free balance ≈ $${(qty * price).toFixed(2)}.`
  };
}

// Exposure Guard: the account-level checks (concurrent trades, daily loss
// cap, per-symbol cooldown) — independent of this specific trade's own
// merits.
function checkExposure(state, symbol, freeQuoteBalance) {
  const global = riskGuard.checkGlobalLimits(state, freeQuoteBalance);
  if (!global.ok) return { agent: 'Exposure Guard', approved: false, reason: global.reason };

  const cooldown = riskGuard.checkSymbolCooldown(state, symbol);
  if (!cooldown.ok) return { agent: 'Exposure Guard', approved: false, reason: cooldown.reason };

  return { agent: 'Exposure Guard', approved: true, reason: 'Within daily loss cap, concurrent-trade limit, and symbol cooldown.' };
}

module.exports = { sizePosition, checkExposure };
