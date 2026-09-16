const config = require('../config');

// General Manager: the last stop before a contract is bought. Never
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

  return {
    action: direction,
    instrument,
    direction,
    stake: positionSizing.margin,
    entryPrice,
    takeProfitAmount: positionSizing.takeProfitAmount,
    stopLossAmount: positionSizing.stopLossAmount,
    reasoning:
      `GENERAL MANAGER: ${direction.toUpperCase()} ${instrument} with $${positionSizing.margin} stake at ${config.MULTIPLIER}x multiplier, entry ~${entryPrice}. ` +
      `${discussion.reasoning} ${positionSizing.reason} ${exposure.reason} 1:3 risk:reward.`
  };
}

module.exports = { finalize };
