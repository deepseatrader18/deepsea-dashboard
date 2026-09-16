// Research Team: two independent analysts look at the same 5-minute
// candles for XAU/USD and each form their own view, deterministically (no
// LLM) so a decision is instant.

function ema(values, period) {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += -diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// Momentum Researcher: short-term trend/strength from price action alone —
// identical method to the crypto team's version.
function momentumResearch(candles) {
  const closes = candles.map(c => c.close);
  if (closes.length < 21) {
    return { agent: 'Momentum Researcher', bias: 'neutral', confidence: 0, notes: 'Not enough candle history yet.' };
  }
  const ema9 = ema(closes.slice(-9), 9);
  const ema21 = ema(closes.slice(-21), 21);
  const r = rsi(closes, 14);
  const last3ChangePct = ((closes[closes.length - 1] - closes[closes.length - 4]) / closes[closes.length - 4]) * 100;

  let bullSignals = 0, total = 0;
  if (typeof ema9 === 'number' && typeof ema21 === 'number') { total++; if (ema9 > ema21) bullSignals++; }
  if (typeof r === 'number') { total++; if (r > 50) bullSignals++; }
  total++; if (last3ChangePct > 0) bullSignals++;

  const ratio = total ? bullSignals / total : 0.5;
  const bias = ratio >= 0.66 ? 'bullish' : ratio <= 0.34 ? 'bearish' : 'neutral';
  const confidence = Math.round(Math.abs(ratio - 0.5) * 200); // 0-100

  return {
    agent: 'Momentum Researcher',
    bias,
    confidence,
    notes: `EMA9 ${ema9 > ema21 ? '>' : '<='} EMA21, RSI14 ${r != null ? r.toFixed(1) : 'n/a'}, last 3-candle move ${last3ChangePct.toFixed(2)}%.`
  };
}

// Range Researcher: gold is an OTC CFD, not an exchange order book, so
// there's no real per-trade buy/sell volume the way Binance has — OANDA's
// own "volume" field is just a tick count. Where each candle closed within
// its own high-low range (closing near the high is buying pressure, near
// the low is selling pressure) is the closest honest substitute, weighted
// by that tick-count activity as a proxy for conviction.
function rangeResearch(candles) {
  if (candles.length < 5) {
    return { agent: 'Range Researcher', bias: 'neutral', confidence: 0, notes: 'Not enough candle history yet.' };
  }
  const recent = candles.slice(-5);
  let rangePosSum = 0;
  const ticks = [];
  for (const c of recent) {
    const range = c.high - c.low;
    rangePosSum += range > 0 ? (c.close - c.low) / range : 0.5;
    ticks.push(c.volume);
  }
  const avgRangePos = rangePosSum / recent.length;
  const lastTicks = ticks[ticks.length - 1];
  const avgPriorTicks = ticks.slice(0, -1).reduce((a, b) => a + b, 0) / (ticks.length - 1 || 1);
  const activitySpike = avgPriorTicks > 0 ? lastTicks / avgPriorTicks : 1;

  const bias = avgRangePos > 0.56 ? 'bullish' : avgRangePos < 0.44 ? 'bearish' : 'neutral';
  const confidence = Math.min(100, Math.round(Math.abs(avgRangePos - 0.5) * 300 + Math.min(activitySpike, 5) * 5));

  return {
    agent: 'Range Researcher',
    bias,
    confidence,
    notes: `Avg close-in-range position ${(avgRangePos * 100).toFixed(1)}% over last 5 candles, latest candle activity ${activitySpike.toFixed(1)}x its recent average.`
  };
}

module.exports = { momentumResearch, rangeResearch };
