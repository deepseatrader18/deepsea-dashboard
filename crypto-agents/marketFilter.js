const futuresClient = require('./futuresClient');

// Broad market regime filter: most altcoins move WITH Bitcoin most of the
// time — a bullish volume surge on some altcoin means far less if BTC
// itself is trending down right now, since the alt is more likely to
// reverse along with it than to hold its own move independently. This is
// refreshed periodically in the background (see index.js), not on the hot
// per-trade path, since the broad market regime changes far slower than
// any single coin's volume surge.
let cached = { bias: 'unknown', updatedAt: 0 };

function ema(values, period) {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

async function refreshBtcTrend() {
  try {
    const klines = await futuresClient.getKlines('BTCUSDT', '5m', 30);
    const closes = klines.map(k => parseFloat(k[4]));
    if (closes.length < 21) return cached;
    const ema9 = ema(closes.slice(-9), 9);
    const ema21 = ema(closes.slice(-21), 21);
    cached = { bias: ema9 > ema21 ? 'bullish' : 'bearish', updatedAt: Date.now() };
  } catch (err) {
    console.error('BTC trend refresh failed:', err.message);
  }
  return cached;
}

// "unknown" (before the first refresh completes) intentionally does not
// block entries — better to trade without this check briefly at startup
// than to sit idle waiting for it.
function getBtcTrend() {
  return cached;
}

module.exports = { refreshBtcTrend, getBtcTrend };
