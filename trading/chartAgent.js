// Chart/Technical Analysis Agent: derives a directional bias purely from the
// already-computed indicators (no LLM). Keeping this deterministic means the
// signal is reproducible and never hallucinates a number that contradicts
// the actual data — which matters most for the levels the Risk Manager will
// build a real position around.
function analyzeChart({ technical }) {
  if (!technical.available) {
    return { available: false, data: { bias: 'neutral', confidence: 'low', summary: `Technical data not available (${technical.reason}).` }, reason: technical.reason };
  }

  const t = technical.data;
  const knownChecks = [
    typeof t.ema9 === 'number' && typeof t.ema50 === 'number',
    typeof t.rsi14 === 'number',
    typeof t.sma50 === 'number',
    typeof t.macdHistogram === 'number'
  ];
  const bullChecks = [
    knownChecks[0] && t.ema9 > t.ema50,
    knownChecks[1] && t.rsi14 > 50,
    knownChecks[2] && t.price > t.sma50,
    knownChecks[3] && t.macdHistogram > 0
  ];

  const knownCount = knownChecks.filter(Boolean).length;
  const bullCount = bullChecks.filter(Boolean).length;

  let bias = 'neutral';
  let confidence = 'low';
  if (knownCount >= 2) {
    const ratio = bullCount / knownCount;
    if (ratio >= 0.75) {
      bias = 'bullish';
      confidence = knownCount >= 4 ? 'high' : 'medium';
    } else if (ratio <= 0.25) {
      bias = 'bearish';
      confidence = knownCount >= 4 ? 'high' : 'medium';
    }
  }

  const summary =
    `${bullCount}/${knownCount} bullish signals — ` +
    `EMA9 ${knownChecks[0] ? (bullChecks[0] ? '>' : '<=') : 'n/a vs'} EMA50, ` +
    `RSI14 ${t.rsi14 != null ? t.rsi14.toFixed(1) : 'n/a'}, ` +
    `price ${knownChecks[2] ? (bullChecks[2] ? 'above' : 'below') : 'vs unknown'} SMA50, ` +
    `MACD ${knownChecks[3] ? (bullChecks[3] ? 'positive' : 'non-positive') : 'n/a'}, ` +
    `trend=${t.trend}.`;

  return {
    available: true,
    data: { bias, confidence, summary, price: t.price, support: t.support, resistance: t.resistance },
    reason: null
  };
}

module.exports = { analyzeChart };
