const config = require('./config');

// Volume-surge detection core, shared by wsScanner.js (the primary,
// real-time path — see there for why) and this file's own scanOnce(),
// kept only as a REST-polling fallback for when WS_SCANNER_ENABLED=false.
// Flags coins whose traded volume just jumped relative to their *own*
// recent average (self-baseline), not a fixed threshold — a raw 24h total
// barely moves snapshot-to-snapshot, so what matters is the delta-per-tick
// against that coin's own recent normal.
const volumeHistory = {}; // symbol -> { prevQuoteVolume, deltas: [] }

function isQuoteMarket(symbol) {
  return symbol.endsWith(config.QUOTE_ASSET) && !symbol.includes('UP' + config.QUOTE_ASSET) && !symbol.includes('DOWN' + config.QUOTE_ASSET);
}

// Call once per (symbol, latest-ticker-snapshot) — from either a WS
// mini-ticker push or a REST 24hr ticker row. Returns a surge object or
// null. Not async: this is pure in-memory math, no I/O, so it's cheap
// enough to call for every symbol on every WS tick.
function evaluateTicker(symbol, quoteVolume, lastPrice, priceChangePct) {
  if (!isQuoteMarket(symbol)) return null;
  if (!Number.isFinite(quoteVolume) || quoteVolume < config.MIN_QUOTE_VOLUME_24H) return null;

  const h = volumeHistory[symbol] || (volumeHistory[symbol] = { prevQuoteVolume: null, deltas: [] });
  if (h.prevQuoteVolume === null) {
    h.prevQuoteVolume = quoteVolume;
    return null; // first sighting, no baseline yet
  }

  const delta = quoteVolume - h.prevQuoteVolume;
  h.prevQuoteVolume = quoteVolume;
  const priorDeltas = h.deltas.filter(d => d > 0);
  h.deltas.push(Math.max(delta, 0));
  if (h.deltas.length > config.VOLUME_HISTORY_LEN) h.deltas.shift();
  if (delta <= 0) return null;

  const baseline = priorDeltas.length >= 3 ? priorDeltas.reduce((a, b) => a + b, 0) / priorDeltas.length : null;
  if (baseline === null) return null;
  if (delta < config.MIN_DELTA_QUOTE_VOLUME || delta < baseline * config.VOLUME_SURGE_MULTIPLIER) return null;

  return {
    symbol,
    lastPrice,
    priceChangePct,
    quoteVolume24h: quoteVolume,
    intervalDelta: delta,
    surgeMultiple: baseline > 0 ? delta / baseline : null
  };
}

// REST fallback: scans a full ticker/24hr response in one pass. Only used
// when the WebSocket scanner is disabled.
async function scanOnce(tickers) {
  const surges = [];
  for (const t of tickers) {
    const surge = evaluateTicker(t.symbol, parseFloat(t.quoteVolume), parseFloat(t.lastPrice), parseFloat(t.priceChangePercent));
    if (surge) surges.push(surge);
  }
  surges.sort((a, b) => (b.surgeMultiple || 0) - (a.surgeMultiple || 0));
  return surges;
}

module.exports = { scanOnce, evaluateTicker, isQuoteMarket };
