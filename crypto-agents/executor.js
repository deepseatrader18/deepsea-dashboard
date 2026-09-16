const config = require('./config');
const futuresClient = require('./futuresClient');

function roundPrice(symbol, price) {
  const filters = futuresClient.getSymbolFilters(symbol);
  return futuresClient.roundStep(price, filters ? filters.tickSize : null);
}

// Executes the General Manager's approved plan on Binance USDT-M Futures —
// a market order to open (BUY for long, SELL for short), followed
// immediately by a STOP_MARKET and a TAKE_PROFIT_MARKET closing order
// (Futures has no single OCO the way Spot does; monitor.js watches both
// and cancels whichever didn't fill). Sized off the *actual* fill, not
// the pre-trade estimate, since price can move between the team's
// decision and the order landing.
//
// When LIVE_TRADING_ENABLED is not exactly "true", or API keys aren't
// configured, this runs the identical decision path but logs a "paper"
// trade instead of calling Binance — the team, the reasoning, and the
// dashboard reporting are all real either way, only the order call itself
// is skipped.
async function executePlan(plan) {
  if (!config.LIVE_TRADING_ENABLED || !config.BINANCE_API_KEY || !config.BINANCE_API_SECRET) {
    return {
      mode: 'paper',
      symbol: plan.symbol,
      direction: plan.direction,
      qty: plan.qty,
      entryPrice: plan.entryPrice,
      tpPrice: plan.tpPrice,
      slStopPrice: plan.slStopPrice,
      margin: plan.margin,
      openedAt: Date.now(),
      reasoning: plan.reasoning + ' [PAPER MODE — no real order placed: set LIVE_TRADING_ENABLED=true and configure Binance API keys to go live.]'
    };
  }

  await futuresClient.ensureLeverage(plan.symbol);

  const openSide = plan.direction === 'long' ? 'BUY' : 'SELL';
  const closeSide = plan.direction === 'long' ? 'SELL' : 'BUY';

  const openOrder = await futuresClient.placeMarketOrder(plan.symbol, openSide, plan.qty);
  const executedQty = parseFloat(openOrder.executedQty);
  const cumQuote = parseFloat(openOrder.cumQuote);
  const avgFillPrice = executedQty > 0 ? cumQuote / executedQty : (parseFloat(openOrder.avgPrice) || plan.entryPrice);

  const sign = plan.direction === 'long' ? 1 : -1;
  const tpPrice = roundPrice(plan.symbol, avgFillPrice * (1 + sign * config.TAKE_PROFIT_PCT / 100));
  const slStopPrice = roundPrice(plan.symbol, avgFillPrice * (1 - sign * config.STOP_LOSS_PCT / 100));

  const [tpOrder, slOrder] = await Promise.all([
    futuresClient.placeTakeProfitMarket(plan.symbol, closeSide, tpPrice),
    futuresClient.placeStopMarket(plan.symbol, closeSide, slStopPrice)
  ]);

  return {
    mode: 'live',
    symbol: plan.symbol,
    direction: plan.direction,
    qty: executedQty || plan.qty,
    entryPrice: avgFillPrice,
    tpPrice,
    slStopPrice,
    margin: plan.margin,
    tpOrderId: tpOrder.orderId,
    slOrderId: slOrder.orderId,
    openOrderId: openOrder.orderId,
    openedAt: Date.now(),
    reasoning: plan.reasoning
  };
}

module.exports = { executePlan };
