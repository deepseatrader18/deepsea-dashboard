const config = require('../config');

// General Manager: the last stop before an order is placed. Never
// overrides a number the Portfolio team computed — only combines their
// sign-offs into one final go/no-go, and writes the human-readable
// reasoning shown on the dashboard. Requires every stage to agree; any
// single "no" anywhere is a hold.
function finalize({ symbol, surge, discussion, positionSizing, exposure }) {
  if (!discussion.proceed) {
    return { action: 'hold', symbol, reasoning: discussion.reasoning };
  }
  if (!exposure.approved) {
    return { action: 'hold', symbol, reasoning: `Exposure Guard blocked this trade: ${exposure.reason}` };
  }
  if (!positionSizing.approved) {
    return { action: 'hold', symbol, reasoning: `Position Sizer blocked this trade: ${positionSizing.reason}` };
  }

  const direction = discussion.direction; // 'long' or 'short'
  const entryPrice = surge.lastPrice;
  // A long profits above entry and stops below; a short is the mirror —
  // profits below entry, stops above.
  const tpPrice = Number((entryPrice * (1 + (direction === 'long' ? 1 : -1) * config.TAKE_PROFIT_PCT / 100)).toPrecision(12));
  const slStopPrice = Number((entryPrice * (1 - (direction === 'long' ? 1 : -1) * config.STOP_LOSS_PCT / 100)).toPrecision(12));

  return {
    action: direction === 'long' ? 'long' : 'short',
    symbol,
    direction,
    qty: positionSizing.qty,
    entryPrice,
    tpPrice,
    slStopPrice,
    margin: positionSizing.margin,
    quoteAmount: positionSizing.quoteAmount,
    reasoning:
      `GENERAL MANAGER: ${direction.toUpperCase()} ${symbol} ≈ $${positionSizing.quoteAmount} notional (${positionSizing.qty} units, $${positionSizing.margin} margin at ${config.FUTURES_LEVERAGE}x) at ~${entryPrice}. ` +
      `${discussion.reasoning} ${positionSizing.reason} ${exposure.reason} ` +
      `Scalp target ${config.TAKE_PROFIT_PCT}% (${tpPrice}), stop ${config.STOP_LOSS_PCT}% (${slStopPrice}) — quick in, small profit, out.`
  };
}

module.exports = { finalize };
