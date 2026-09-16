// Research Team: two independent analysts look at the same klines (see
// config.KLINE_INTERVAL) for a volume-surging coin and each form their own
// view, exactly like the
// existing TradingAgents Bull/Bear split in trading-agents-service/, but
// short-timeframe and deterministic (no LLM) since a scalp entry needs an
// answer in milliseconds, not minutes.

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

// Momentum Researcher: short-term trend/strength from price action alone.
function momentumResearch(klines) {
  const closes = klines.map(k => parseFloat(k[4]));
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

// Volume Researcher: is the surge real buying pressure or just noisy churn?
// Uses each candle's taker-buy-base-volume vs total volume (Binance kline
// field index 9) — a high ratio means market buys dominated that candle.
function volumeResearch(klines) {
  if (klines.length < 5) {
    return { agent: 'Volume Researcher', bias: 'neutral', confidence: 0, notes: 'Not enough candle history yet.' };
  }
  const recent = klines.slice(-5);
  let buyRatioSum = 0;
  let volumes = [];
  for (const k of recent) {
    const volume = parseFloat(k[5]);
    const takerBuyBase = parseFloat(k[9]);
    volumes.push(volume);
    buyRatioSum += volume > 0 ? takerBuyBase / volume : 0.5;
  }
  const avgBuyRatio = buyRatioSum / recent.length;
  const lastVolume = volumes[volumes.length - 1];
  const avgPriorVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1 || 1);
  const volumeSpike = avgPriorVolume > 0 ? lastVolume / avgPriorVolume : 1;

  const bias = avgBuyRatio > 0.56 ? 'bullish' : avgBuyRatio < 0.44 ? 'bearish' : 'neutral';
  const confidence = Math.min(100, Math.round(Math.abs(avgBuyRatio - 0.5) * 300 + Math.min(volumeSpike, 5) * 5));

  return {
    agent: 'Volume Researcher',
    bias,
    confidence,
    notes: `Taker-buy ratio ${(avgBuyRatio * 100).toFixed(1)}% over last 5 candles, latest candle volume ${volumeSpike.toFixed(1)}x its recent average.`
  };
}

module.exports = { momentumResearch, volumeResearch };
