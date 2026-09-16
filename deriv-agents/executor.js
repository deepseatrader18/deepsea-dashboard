const config = require('./config');
const derivClient = require('./derivClient');

// Executes the General Manager's approved plan on Deriv — buys a Multiplier
// contract with the take-profit/stop-loss attached directly to it, same
// "one order, broker-guaranteed single exit" idea as the OANDA team's
// bracket orders.
//
// When LIVE_TRADING_ENABLED is not exactly "true", or no API token is
// configured, this runs the identical decision path but logs a "paper"
// trade instead of calling Deriv.
async function executePlan(plan) {
  if (!config.LIVE_TRADING_ENABLED || !config.DERIV_API_TOKEN) {
    return {
      mode: 'paper',
      instrument: plan.instrument,
      direction: plan.direction,
      margin: plan.stake,
      multiplier: config.MULTIPLIER,
      entryPrice: plan.entryPrice,
      // Paper mode still needs a price-level TP/SL to check against a live
      // tick, so re-derive them here from the same % move the monetary
      // amounts were built from (see team/portfolio.js).
      tpPrice: Number((plan.entryPrice * (1 + (plan.direction === 'long' ? 1 : -1) * config.TAKE_PROFIT_PCT / 100)).toFixed(5)),
      slStopPrice: Number((plan.entryPrice * (1 - (plan.direction === 'long' ? 1 : -1) * config.STOP_LOSS_PCT / 100)).toFixed(5)),
      openedAt: Date.now(),
      reasoning: plan.reasoning + ' [PAPER MODE — no real contract bought: set LIVE_TRADING_ENABLED=true and configure a real DERIV_API_TOKEN to go live.]'
    };
  }

  const fill = await derivClient.buyMultiplier({
    symbol: plan.instrument,
    direction: plan.direction,
    stake: plan.stake,
    multiplier: config.MULTIPLIER,
    takeProfitAmount: plan.takeProfitAmount,
    stopLossAmount: plan.stopLossAmount
  });

  return {
    mode: 'live',
    instrument: plan.instrument,
    direction: plan.direction,
    margin: plan.stake,
    entryPrice: fill.entrySpot || plan.entryPrice,
    contractId: fill.contractId,
    openedAt: Date.now(),
    reasoning: plan.reasoning
  };
}

module.exports = { executePlan };
