const config = require('./config');
const binance = require('./binanceClient');

// Continuously scans every <QUOTE_ASSET> pair on Binance (not a fixed
// watchlist — the whole exchange) and flags coins whose traded volume just
// jumped relative to their *own* recent average, the same "self-baseline"
// approach the existing CoinGecko scanner in index.js uses and for the same
// reason: a raw 24h total is a slow rolling number, so comparing it
// snapshot-to-snapshot every ~20s barely moves — what matters is the
// delta-per-interval against that coin's own recent normal.
const volumeHistory = {}; // symbol -> { prevQuoteVolume, deltas: [] }

function isQuoteMarket(symbol) {
  return symbol.endsWith(config.QUOTE_ASSET) && !symbol.includes('UP' + config.QUOTE_ASSET) && !symbol.includes('DOWN' + config.QUOTE_ASSET);
}

// Accepts an already-fetched ticker list (index.js fetches it once per
// tick and reuses it both here and for pricing open positions) rather than
// calling the API again itself.
async function scanOnce(tickers) {
  const surges = [];

  for (const t of tickers) {
    if (!isQuoteMarket(t.symbol)) continue;
    const quoteVolume = parseFloat(t.quoteVolume);
    if (!Number.isFinite(quoteVolume) || quoteVolume < config.MIN_QUOTE_VOLUME_24H) continue;

    const h = volumeHistory[t.symbol] || (volumeHistory[t.symbol] = { prevQuoteVolume: null, deltas: [] });
    if (h.prevQuoteVolume === null) {
      h.prevQuoteVolume = quoteVolume;
      continue; // first sighting, no baseline yet
    }

    const delta = quoteVolume - h.prevQuoteVolume;
    h.prevQuoteVolume = quoteVolume;
    const priorDeltas = h.deltas.filter(d => d > 0);
    h.deltas.push(Math.max(delta, 0));
    if (h.deltas.length > config.VOLUME_HISTORY_LEN) h.deltas.shift();
    if (delta <= 0) continue;

    const baseline = priorDeltas.length >= 3 ? priorDeltas.reduce((a, b) => a + b, 0) / priorDeltas.length : null;
    if (baseline === null) continue;
    if (delta < config.MIN_DELTA_QUOTE_VOLUME || delta < baseline * config.VOLUME_SURGE_MULTIPLIER) continue;

    surges.push({
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      priceChangePct: parseFloat(t.priceChangePercent),
      quoteVolume24h: quoteVolume,
      intervalDelta: delta,
      surgeMultiple: baseline > 0 ? delta / baseline : null
    });
  }

  // Strongest surge first — the pipeline processes one candidate at a time
  // (real account balance/risk checks aren't safely parallelizable anyway).
  surges.sort((a, b) => (b.surgeMultiple || 0) - (a.surgeMultiple || 0));
  return surges;
}

module.exports = { scanOnce };
