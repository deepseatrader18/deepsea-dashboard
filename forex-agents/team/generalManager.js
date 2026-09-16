const config = require('../config');

// General Manager: the last stop before an order is placed. Never
// overrides a number the Portfolio team computed — only combines their
// sign-offs into one final go/no-go. Requires every stage to agree; any
// single "no" anywhere is a hold.
function finalize({ instrument, entryPrice, discussion, positionSizing, exposure }) {
  if (!discussion.proceed) {
    return { action: 'hold', instrument, reasoning: discussion.reasoning };
  }
  if (!exposure.approved) {
    return { action: 'hold', instrument, reasoning: `Exposure Guard blocked this trade: ${exposure.reason}` };
  }
  if (!positionSizing.approved) {
    return { action: 'hold', instrument, reasoning: `Position Sizer blocked this trade: ${positionSizing.reason}` };
  }

  const direction = discussion.direction; // 'long' or 'short'
  const sign = direction === 'long' ? 1 : -1;
  const tpPrice = Number((entryPrice * (1 + sign * config.TAKE_PROFIT_PCT / 100)).toFixed(5));
  const slStopPrice = Number((entryPrice * (1 - sign * config.STOP_LOSS_PCT / 100)).toFixed(5));

  return {
    action: direction,
    instrument,
    direction,
    units: positionSizing.units,
    entryPrice,
    tpPrice,
    slStopPrice,
    margin: positionSizing.margin,
    quoteAmount: positionSizing.quoteAmount,
    reasoning:
      `GENERAL MANAGER: ${direction.toUpperCase()} ${instrument} ≈ $${positionSizing.quoteAmount} notional (${positionSizing.units} units, $${positionSizing.margin} margin at ${config.FOREX_LEVERAGE}x) at ~${entryPrice}. ` +
      `${discussion.reasoning} ${positionSizing.reason} ${exposure.reason} ` +
      `Target ${config.TAKE_PROFIT_PCT}% (${tpPrice}), stop ${config.STOP_LOSS_PCT}% (${slStopPrice}) — 1:3 risk:reward.`
  };
}

module.exports = { finalize };
