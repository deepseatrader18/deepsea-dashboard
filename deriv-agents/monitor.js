const derivClient = require('./derivClient');
const riskGuard = require('./riskGuard');

// Watches every open position (across every pair) for its exit. Live
// positions closed by Deriv's own attached take_profit/stop_loss are
// detected by polling that contract's is_sold state; paper positions are
// checked against a fresh price the same way the other two teams' paper
// mode does.

// Multiplier contract P/L ≈ stake * multiplier * (price change / entry
// price), signed for direction — mirrors the same formula used to convert
// STOP_LOSS_PCT/TAKE_PROFIT_PCT into monetary amounts in team/portfolio.js.
function computePnl(pos, exitPrice) {
  const priceChangePct = (exitPrice - pos.entryPrice) / pos.entryPrice;
  const directional = pos.direction === 'short' ? -priceChangePct : priceChangePct;
  return (pos.margin || 0) * (pos.multiplier || 1) * directional;
}

async function checkLivePosition(pos) {
  const contract = await derivClient.getContract(pos.contractId);
  if (!contract.isSold) return null;
  const exitPrice = contract.sellPrice != null ? contract.sellPrice : pos.entryPrice;
  const pnlQuote = contract.profit != null ? contract.profit : 0;
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
