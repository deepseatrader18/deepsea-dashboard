const binance = require('./binanceClient');
const riskGuard = require('./riskGuard');
const balanceCache = require('./balanceCache');

// Watches every open position for its exit (take-profit or stop-loss) and
// records the closed trade with realized P/L, which is what feeds the
// daily loss cap in riskGuard. Runs once per tick from index.js for both
// live and paper positions.

async function checkLivePosition(symbol, pos) {
  const [tpOrder, slOrder] = await Promise.all([
    pos.tpOrderId ? binance.getOrder(symbol, pos.tpOrderId).catch(() => null) : null,
    pos.slOrderId ? binance.getOrder(symbol, pos.slOrderId).catch(() => null) : null
  ]);

  const filled = [tpOrder, slOrder].find(o => o && o.status === 'FILLED');
  if (!filled) return null;

  const exitQty = parseFloat(filled.executedQty);
  const exitQuote = parseFloat(filled.cummulativeQuoteQty);
  const exitPrice = exitQty > 0 ? exitQuote / exitQty : (filled === tpOrder ? pos.tpPrice : pos.slStopPrice);
  const outcome = filled === tpOrder ? 'target_hit' : 'stopped_out';
  const pnlQuote = (exitPrice - pos.entryPrice) * pos.qty;

  return { symbol, outcome, exitPrice, pnlQuote, closedAt: Date.now() };
}

async function checkPaperPosition(symbol, pos, currentPrice) {
  if (typeof currentPrice !== 'number') return null;
  if (currentPrice >= pos.tpPrice) {
    return { symbol, outcome: 'target_hit', exitPrice: pos.tpPrice, pnlQuote: (pos.tpPrice - pos.entryPrice) * pos.qty, closedAt: Date.now() };
  }
  if (currentPrice <= pos.slStopPrice) {
    return { symbol, outcome: 'stopped_out', exitPrice: pos.slStopPrice, pnlQuote: (pos.slStopPrice - pos.entryPrice) * pos.qty, closedAt: Date.now() };
  }
  return null;
}

async function checkOpenPositions(state, latestPrices) {
  const closedTrades = [];
  for (const [symbol, pos] of Object.entries(state.openPositions)) {
    try {
      const closed = pos.mode === 'live'
        ? await checkLivePosition(symbol, pos)
        : await checkPaperPosition(symbol, pos, latestPrices[symbol]);

      if (closed) {
        const closedTrade = { ...pos, ...closed };
        riskGuard.recordClose(state, symbol, closedTrade);
        if (closedTrade.mode === 'live') {
          balanceCache.adjustLiveBalance(closedTrade.exitPrice * closedTrade.qty);
        }
        closedTrades.push(closedTrade);
      }
    } catch (err) {
      console.error(`Monitor check failed for ${symbol}:`, err.message);
    }
  }
  return closedTrades;
}

module.exports = { checkOpenPositions };
