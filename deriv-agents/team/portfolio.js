const config = require('../config');
const riskGuard = require('../riskGuard');

// Portfolio Management: Position Sizer commits PER_TRADE_RISK_PCT of free
// balance as the Multiplier contract's "stake" — config.MULTIPLIER then
// decides how much price-move exposure that stake controls, same "1% of
// capital per trade" intuition as the other two teams, just in Deriv's own
// stake+multiplier terms instead of margin+leverage or margin+units.
function sizePosition(instrument, price, freeBalance) {
  const stake = Number((freeBalance * (config.PER_TRADE_RISK_PCT / 100)).toFixed(2));

  if (stake < 1) {
    return {
      agent: 'Position Sizer',
      approved: false,
      reason: `Stake $${stake.toFixed(2)} (${config.PER_TRADE_RISK_PCT}% of free balance $${freeBalance.toFixed(2)}) is below Deriv's practical minimum stake — increase PER_TRADE_RISK_PCT or account balance.`
    };
  }

  // Multiplier contract P/L ≈ stake * multiplier * (price change / entry
  // price) — so a price-move-based stop/target (STOP_LOSS_PCT,
  // TAKE_PROFIT_PCT, same 1:3 ratio as the other two teams) converts to a
  // MONETARY take_profit/stop_loss the way Deriv's own API actually wants.
  const stopLossAmount = Number((stake * config.MULTIPLIER * (config.STOP_LOSS_PCT / 100)).toFixed(2));
  const takeProfitAmount = Number((stake * config.MULTIPLIER * (config.TAKE_PROFIT_PCT / 100)).toFixed(2));

  return {
    agent: 'Position Sizer',
    approved: true,
    margin: stake, // kept as "margin" internally for riskGuard.js's generic paper-balance bookkeeping
    stopLossAmount,
    takeProfitAmount,
    reason: `Sizing ${instrument} with $${stake.toFixed(2)} stake (${config.PER_TRADE_RISK_PCT}% of free balance) at ${config.MULTIPLIER}x multiplier — take_profit $${takeProfitAmount}, stop_loss $${stopLossAmount} (1:3).`
  };
}

// Exposure Guard: account-level checks (daily loss cap, total exposure
// cap, concurrent-trade limit, per-pair cooldown) — independent of this
// specific trade's own merits.
function checkExposure(state, instrument, freeBalance) {
  const global = riskGuard.checkGlobalLimits(state, freeBalance);
  if (!global.ok) return { agent: 'Exposure Guard', approved: false, reason: global.reason };

  const cooldown = riskGuard.checkCooldown(state, instrument);
  if (!cooldown.ok) return { agent: 'Exposure Guard', approved: false, reason: cooldown.reason };

  return { agent: 'Exposure Guard', approved: true, reason: 'Within daily loss cap, total exposure cap, concurrent-trade limit, and pair cooldown.' };
}

module.exports = { sizePosition, checkExposure };
