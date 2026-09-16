const config = require('../config');
const oandaClient = require('../oandaClient');
const riskGuard = require('../riskGuard');

// Portfolio Management: two agents, each with veto power. Position Sizer
// commits PER_TRADE_RISK_PCT of free balance as margin, FOREX_LEVERAGE
// then decides how much notional (and therefore how many ounces) that
// margin controls — the same "1% of capital per trade" intuition as the
// crypto team, just priced in ounces of gold instead of coin quantity.
async function sizePosition(instrument, price, freeBalance) {
  const margin = freeBalance * (config.PER_TRADE_RISK_PCT / 100);
  const notional = margin * config.FOREX_LEVERAGE;
  const units = Math.floor(notional / price); // OANDA trades in whole units per instrument

  if (units < 1) {
    return {
      agent: 'Position Sizer',
      approved: false,
      reason: `Position size $${notional.toFixed(2)} (${config.FOREX_LEVERAGE}x on $${margin.toFixed(2)} margin) at ~${price.toFixed(4)} rounds to 0 whole units for ${instrument} — increase PER_TRADE_RISK_PCT, FOREX_LEVERAGE, or account balance.`
    };
  }

  const actualNotional = units * price;

  // Sanity check against the broker's own margin requirement — never the
  // primary sizing input (FOREX_LEVERAGE is), just a guard against sizing
  // bigger than the account can actually margin.
  let marginRate = 0.05;
  try { marginRate = await oandaClient.getMarginRate(instrument); } catch { /* use fallback */ }
  const requiredMargin = actualNotional * marginRate;
  if (requiredMargin > freeBalance * 0.9) {
    return {
      agent: 'Position Sizer',
      approved: false,
      reason: `Broker margin required ($${requiredMargin.toFixed(2)}) for ${units} units of ${instrument} would use too much of the free balance ($${freeBalance.toFixed(2)}) — skipping.`
    };
  }

  return {
    agent: 'Position Sizer',
    approved: true,
    margin: Number(margin.toFixed(2)),
    quoteAmount: Number(actualNotional.toFixed(2)),
    units,
    reason: `Sizing ${instrument} with $${margin.toFixed(2)} margin (${config.PER_TRADE_RISK_PCT}% of free balance) at ${config.FOREX_LEVERAGE}x leverage ≈ $${actualNotional.toFixed(2)} notional (${units} units).`
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
