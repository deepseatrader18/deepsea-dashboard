const config = require('./config');
const futuresClient = require('./futuresClient');
const riskGuard = require('./riskGuard');
const balanceCache = require('./balanceCache');

// Watches every open position for its exit (take-profit or stop-loss) and
// records the closed trade with realized P/L, which is what feeds the
// daily loss cap in riskGuard. Runs once per tick from index.js for both
// live and paper positions, long and short alike.

function computePnl(pos, exitPrice) {
  // Long profits when price rises, short profits when price falls.
  return pos.direction === 'short' ? (pos.entryPrice - exitPrice) * pos.qty : (exitPrice - pos.entryPrice) * pos.qty;
}

async function checkLivePosition(symbol, pos, currentPrice) {
  const [tpOrder, slOrder] = await Promise.all([
    pos.tpOrderId ? futuresClient.getOrder(symbol, pos.tpOrderId).catch(() => null) : null,
    pos.slOrderId ? futuresClient.getOrder(symbol, pos.slOrderId).catch(() => null) : null
  ]);

  const filled = [tpOrder, slOrder].find(o => o && o.status === 'FILLED');
  if (filled) {
    // closePosition orders don't always report avgPrice reliably at the
    // instant they fill — the trigger price is the reliable fallback.
    const exitPrice = parseFloat(filled.avgPrice) || (filled === tpOrder ? pos.tpPrice : pos.slStopPrice);
    const outcome = filled === tpOrder ? 'target_hit' : 'stopped_out';
    const other = filled === tpOrder ? slOrder : tpOrder;
    if (other && other.orderId) {
      await futuresClient.cancelOrder(symbol, other.orderId).catch(() => {}); // already gone if it also triggered
    }
    return { symbol, outcome, exitPrice, pnlQuote: computePnl(pos, exitPrice), closedAt: Date.now() };
  }

  // Gap protection: a fast/illiquid move can jump straight through a
  // STOP_MARKET trigger without the order actually executing in time (rare,
  // but the whole point of this check is the case that isn't supposed to
  // happen). If price has moved past the stop by more than a buffer and
  // neither leg has filled, force the position closed with a market order
  // instead of leaving it open and exposed indefinitely — this is what
  // actually keeps a live account from being wiped out by a single bad gap.
  if (typeof currentPrice === 'number') {
    const buffer = config.GAP_PROTECTION_BUFFER_PCT / 100;
    const gapped = pos.direction === 'short'
      ? currentPrice >= pos.slStopPrice * (1 + buffer)
      : currentPrice <= pos.slStopPrice * (1 - buffer);
    if (gapped) {
      console.error(`GAP PROTECTION triggered for ${symbol}: price ${currentPrice} is past stop ${pos.slStopPrice} by more than ${config.GAP_PROTECTION_BUFFER_PCT}% — force-closing with a market order.`);
      await Promise.all([
        pos.tpOrderId ? futuresClient.cancelOrder(symbol, pos.tpOrderId).catch(() => {}) : null,
        pos.slOrderId ? futuresClient.cancelOrder(symbol, pos.slOrderId).catch(() => {}) : null
      ]);
      const closeSide = pos.direction === 'short' ? 'BUY' : 'SELL';
      const closeOrder = await futuresClient.placeMarketOrder(symbol, closeSide, pos.qty, true);
      const exitQty = parseFloat(closeOrder.executedQty);
      const exitQuote = parseFloat(closeOrder.cumQuote);
      const exitPrice = exitQty > 0 ? exitQuote / exitQty : currentPrice;
      return { symbol, outcome: 'stopped_out', exitPrice, pnlQuote: computePnl(pos, exitPrice), closedAt: Date.now() };
    }
  }

  return null;
}

async function checkPaperPosition(symbol, pos, currentPrice) {
  if (typeof currentPrice !== 'number') return null;
  const hitTp = pos.direction === 'short' ? currentPrice <= pos.tpPrice : currentPrice >= pos.tpPrice;
  const hitSl = pos.direction === 'short' ? currentPrice >= pos.slStopPrice : currentPrice <= pos.slStopPrice;
  if (hitTp) {
    return { symbol, outcome: 'target_hit', exitPrice: pos.tpPrice, pnlQuote: computePnl(pos, pos.tpPrice), closedAt: Date.now() };
  }
  if (hitSl) {
    return { symbol, outcome: 'stopped_out', exitPrice: pos.slStopPrice, pnlQuote: computePnl(pos, pos.slStopPrice), closedAt: Date.now() };
  }
  return null;
}

async function checkOpenPositions(state, latestPrices) {
  const closedTrades = [];
  for (const [symbol, pos] of Object.entries(state.openPositions)) {
    try {
      const closed = pos.mode === 'live'
        ? await checkLivePosition(symbol, pos, latestPrices[symbol])
        : await checkPaperPosition(symbol, pos, latestPrices[symbol]);

      if (closed) {
        const closedTrade = { ...pos, ...closed };
        riskGuard.recordClose(state, symbol, closedTrade);
        if (closedTrade.mode === 'live') {
          balanceCache.adjustLiveBalance(closedTrade.margin + closedTrade.pnlQuote);
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
