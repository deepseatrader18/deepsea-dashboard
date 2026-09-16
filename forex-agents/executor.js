const config = require('./config');
const oandaClient = require('./oandaClient');

// Executes the General Manager's approved plan on OANDA — a market order
// with the take-profit AND stop-loss attached directly to it
// (stopLossOnFill/takeProfitOnFill), so unlike the crypto team's Futures
// setup there's no separate conditional-order race to monitor: the broker
// guarantees only one leg ever triggers.
//
// When LIVE_TRADING_ENABLED is not exactly "true", or OANDA credentials
// aren't configured, this runs the identical decision path but logs a
// "paper" trade instead of calling OANDA.
async function executePlan(plan) {
  if (!config.LIVE_TRADING_ENABLED || !config.OANDA_API_TOKEN || !config.OANDA_ACCOUNT_ID) {
    return {
      mode: 'paper',
      instrument: plan.instrument,
      direction: plan.direction,
      units: plan.units,
      entryPrice: plan.entryPrice,
      tpPrice: plan.tpPrice,
      slStopPrice: plan.slStopPrice,
      margin: plan.margin,
      openedAt: Date.now(),
      reasoning: plan.reasoning + ' [PAPER MODE — no real order placed: set LIVE_TRADING_ENABLED=true and configure OANDA_ENVIRONMENT=live + real API credentials to go live.]'
    };
  }

  const signedUnits = plan.direction === 'long' ? plan.units : -plan.units;
  const fill = await oandaClient.placeMarketOrderWithBrackets(plan.instrument, signedUnits, plan.slStopPrice, plan.tpPrice);

  return {
    mode: 'live',
    instrument: plan.instrument,
    direction: plan.direction,
    units: Math.abs(fill.units) || plan.units,
    entryPrice: fill.avgFillPrice,
    tpPrice: plan.tpPrice,
    slStopPrice: plan.slStopPrice,
    margin: plan.margin,
    tradeID: fill.tradeID,
    openedAt: Date.now(),
    reasoning: plan.reasoning
  };
}

module.exports = { executePlan };
