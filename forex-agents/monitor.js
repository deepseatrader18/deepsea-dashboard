const oandaClient = require('./oandaClient');
const riskGuard = require('./riskGuard');

// Watches every open position (across every pair) for its exit. Live
// positions closed by OANDA's own attached bracket order are detected by
// polling that trade's state; paper positions are checked against a fresh
// price the same way the crypto team's paper mode does.

function computePnl(pos, exitPrice) {
  return pos.direction === 'short' ? (pos.entryPrice - exitPrice) * pos.units : (exitPrice - pos.entryPrice) * pos.units;
}

async function checkLivePosition(pos) {
  const trade = await oandaClient.getTrade(pos.tradeID);
  if (trade.state !== 'CLOSED') return null;
  const exitPrice = trade.averageClosePrice != null ? trade.averageClosePrice : pos.entryPrice;
  // OANDA's own realized P/L, in account currency — more accurate than
  // recomputing from price alone (it already accounts for spread/financing).
  const pnlQuote = trade.realizedPL;
  const outcome = pnlQuote >= 0 ? 'target_hit' : 'stopped_out';
  return { outcome, exitPrice, pnlQuote, closedAt: Date.now() };
}

async function checkPaperPosition(pos, currentPrice) {
  if (typeof currentPrice !== 'number') return null;
  const hitTp = pos.direction === 'short' ? currentPrice <= pos.tpPrice : currentPrice >= pos.tpPrice;
  const hitSl = pos.direction === 'short' ? currentPrice >= pos.slStopPrice : currentPrice <= pos.slStopPrice;
  if (hitTp) return { outcome: 'target_hit', exitPrice: pos.tpPrice, pnlQuote: computePnl(pos, pos.tpPrice), closedAt: Date.now() };
  if (hitSl) return { outcome: 'stopped_out', exitPrice: pos.slStopPrice, pnlQuote: computePnl(pos, pos.slStopPrice), closedAt: Date.now() };
  return null;
}

async function checkOpenPositions(state, latestPrices) {
  const closedTrades = [];
  for (const [instrument, pos] of Object.entries(state.openPositions)) {
    try {
      const closed = pos.mode === 'live'
        ? await checkLivePosition(pos)
        : await checkPaperPosition(pos, latestPrices[instrument]);

      if (closed) {
        const closedTrade = { ...pos, ...closed };
        riskGuard.recordClose(state, instrument, closedTrade);
        closedTrades.push(closedTrade);
      }
    } catch (err) {
      console.error(`Monitor check failed for ${instrument}:`, err.message);
    }
  }
  return closedTrades;
}

module.exports = { checkOpenPositions };
