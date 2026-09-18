const config = require('./config');
const binance = require('./binanceClient');

function roundPrice(symbol, price) {
  const filters = binance.getSymbolFilters(symbol);
  return binance.roundStep(price, filters ? filters.tickSize : null);
}

// Executes the General Manager's approved plan: a real market buy followed
// immediately by an OCO sell (take-profit + stop-loss) sized off the
// *actual* fill, not the pre-trade estimate — price can move between the
// team's decision and the order landing, and trading fees shave a sliver
// off the base asset received, so re-deriving both from the real fill is
// what keeps the exit order valid instead of getting rejected for
// exceeding the free balance.
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
      qty: plan.qty,
      entryPrice: plan.entryPrice,
      tpPrice: plan.tpPrice,
      slStopPrice: plan.slStopPrice,
      openedAt: Date.now(),
      reasoning: plan.reasoning + ' [PAPER MODE — no real order placed: set LIVE_TRADING_ENABLED=true and configure Binance API keys to go live.]'
    };
  }

  const buyOrder = await binance.placeMarketBuy(plan.symbol, plan.quoteAmount);
  const executedQty = parseFloat(buyOrder.executedQty);
  const cumQuote = parseFloat(buyOrder.cummulativeQuoteQty);
  const avgFillPrice = executedQty > 0 ? cumQuote / executedQty : plan.entryPrice;

  const filters = binance.getSymbolFilters(plan.symbol);
  const freeBase = await binance.getFreeBalance(filters.baseAsset);
  const sellQty = binance.roundStep(Math.min(executedQty, freeBase), filters.stepSize);

  if (!sellQty || sellQty <= 0) {
    throw new Error(`Bought ${plan.symbol} but sellable quantity rounded to 0 — cannot place exit order (buyOrder=${JSON.stringify(buyOrder)})`);
  }

  const tpPrice = roundPrice(plan.symbol, avgFillPrice * (1 + config.TAKE_PROFIT_PCT / 100));
  const slStopPrice = roundPrice(plan.symbol, avgFillPrice * (1 - config.STOP_LOSS_PCT / 100));
  const slLimitPrice = roundPrice(plan.symbol, slStopPrice * 0.998);

  const ocoOrder = await binance.placeOcoSell(plan.symbol, sellQty, tpPrice, slStopPrice, slLimitPrice);
  const legs = ocoOrder.orderReports || [];
  const tpLeg = legs.find(l => l.type === 'LIMIT_MAKER' || l.type === 'LIMIT');
  const slLeg = legs.find(l => l.type === 'STOP_LOSS_LIMIT' || l.type === 'STOP_LOSS');

  return {
    mode: 'live',
    symbol: plan.symbol,
    qty: sellQty,
    entryPrice: avgFillPrice,
    tpPrice,
    slStopPrice,
    ocoOrderListId: ocoOrder.orderListId,
    tpOrderId: tpLeg ? tpLeg.orderId : null,
    slOrderId: slLeg ? slLeg.orderId : null,
    buyOrderId: buyOrder.orderId,
    openedAt: Date.now(),
    reasoning: plan.reasoning
  };
}

module.exports = { executePlan };
