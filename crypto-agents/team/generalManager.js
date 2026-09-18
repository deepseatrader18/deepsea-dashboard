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

  const entryPrice = surge.lastPrice;
  const tpPrice = Number((entryPrice * (1 + config.TAKE_PROFIT_PCT / 100)).toPrecision(12));
  const slStopPrice = Number((entryPrice * (1 - config.STOP_LOSS_PCT / 100)).toPrecision(12));
  // Stop-limit leg needs a limit price slightly below the trigger so it
  // actually fills in a fast drop instead of sitting unfilled above the
  // market — a small fixed buffer under the stop trigger.
  const slLimitPrice = Number((slStopPrice * 0.998).toPrecision(12));

  return {
    action: 'buy',
    symbol,
    qty: positionSizing.qty,
    entryPrice,
    tpPrice,
    slStopPrice,
    slLimitPrice,
    quoteAmount: positionSizing.quoteAmount,
    reasoning:
      `GENERAL MANAGER: BUY ${symbol} ≈ $${positionSizing.quoteAmount} (${positionSizing.qty} units) at ~${entryPrice}. ` +
      `${discussion.reasoning} ${positionSizing.reason} ${exposure.reason} ` +
      `Scalp target +${config.TAKE_PROFIT_PCT}% (${tpPrice}), stop -${config.STOP_LOSS_PCT}% (${slStopPrice}) — quick in, small profit, out.`
  };
}

module.exports = { finalize };
