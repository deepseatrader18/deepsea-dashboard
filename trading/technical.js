// Technical analysis computed directly in this process instead of proxying
// to a separate Python service. The old setup (a second Render service)
// slept after ~15 min idle and took 30-50s to wake, so the first dashboard
// load after any gap reported "unavailable" — computing indicators here
// removes that extra network hop and its cold-start entirely: as long as
// the dashboard itself is up (which it is while anyone is using it), this
// responds immediately.
const TWELVE_DATA_URL = 'https://api.twelvedata.com/time_series';

const SYMBOL_MAP = {
  XAUUSD: 'XAU/USD',
  BTCUSD: 'BTC/USD',
  EURUSD: 'EUR/USD'
};

// Candles are 5 minutes, so there's no point caching longer than one candle
// — a new candle can't exist before then anyway. This also keeps Twelve
// Data usage well under the free tier's 800 req/day: 1 call per symbol per
// 5 min, worst case (page open continuously) is ~288/day per symbol.
const CACHE_TTL_SUCCESS_MS = 5 * 60 * 1000;
const CACHE_TTL_FAILURE_MS = 1 * 60 * 1000;
const cache = {};

// Timeframe labels used by the Gold Scalper multi-timeframe view, mapped to
// Twelve Data's own interval strings. Cached per (symbol, interval) pair —
// same TTL reasoning as above, just keyed one level deeper.
const MULTI_TIMEFRAME_INTERVALS = { M1: '1min', M15: '15min', H1: '1h' };

function emaSeries(values, span) {
  const k = 2 / (span + 1);
  const out = new Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function sma(values, period) {
  if (values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((a, b) => a + b, 0) / period;
}

// Wilder's smoothing (the standard used by MT5/TradingView/every broker
// platform, not a plain rolling mean): seed with a simple average of the
// first `period` gains/losses, then recursively smooth through the rest of
// the history. A plain rolling-mean RSI gives noticeably different numbers
// from what a trader sees on their own chart.
function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeMACDHistogram(closes) {
  if (closes.length < 26) return null;
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const signalLine = emaSeries(macdLine, 9);
  const n = closes.length;
  return macdLine[n - 1] - signalLine[n - 1];
}

// Wilder's smoothing (same method as RSI above, and what MT5/TradingView
// use for ATR by default): seed with a simple average of the first
// `period` true ranges, then recursively smooth through the rest of the
// history. This directly feeds the Risk Manager's stop-loss distance, so
// matching the standard method matters for the sizes to look right.
function computeATR(highs, lows, closes, period = 14) {
  const n = closes.length;
  if (n < period) return null;
  const tr = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i]);
    } else {
      tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

// Wilder's DI+/DI-/ADX — same smoothing method as RSI/ATR above, and the
// same regime-strength reading the Gold Scalper MT5 EA uses to decide
// TRENDING vs RANGING (see DeepSeaGoldScalperPro.mq5's DetectRegime()).
// Keeping the math identical here means the dashboard's "market direction"
// panel reflects the EA's actual decision logic, not a separate approximation.
function computeADX(highs, lows, closes, period = 14) {
  const n = closes.length;
  if (n < period + 1) return null;

  const plusDM = [];
  const minusDM = [];
  const tr = [];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  if (plusDM.length < period) return null;

  const wilderSmooth = arr => {
    let smoothed = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [smoothed];
    for (let i = period; i < arr.length; i++) {
      smoothed = smoothed - smoothed / period + arr[i];
      out.push(smoothed);
    }
    return out;
  };

  const smoothedTR = wilderSmooth(tr);
  const smoothedPlusDM = wilderSmooth(plusDM);
  const smoothedMinusDM = wilderSmooth(minusDM);

  const dx = [];
  for (let i = 0; i < smoothedTR.length; i++) {
    if (smoothedTR[i] === 0) { dx.push(0); continue; }
    const plusDI = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
    const minusDI = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
    const diSum = plusDI + minusDI;
    dx.push(diSum === 0 ? 0 : (Math.abs(plusDI - minusDI) / diSum) * 100);
  }
  if (dx.length < period) return null;

  let adx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return adx;
}

// Choppiness Index: 100 * log10( sum(true range, n) / (highest high, n - lowest low, n) ) / log10(n).
// Textbook: <38.2 strong trend, >61.8 ranging. Same formula the EA uses.
function computeChoppinessIndex(highs, lows, closes, period = 14) {
  const n = closes.length;
  if (n < period + 1) return null;

  let trSum = 0;
  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  for (let i = n - period; i < n; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    trSum += tr;
    if (highs[i] > highestHigh) highestHigh = highs[i];
    if (lows[i] < lowestLow) lowestLow = lows[i];
  }
  const range = highestHigh - lowestLow;
  if (range <= 0) return null;
  return (100 * Math.log10(trSum / range)) / Math.log10(period);
}

// Same thresholds as DeepSeaGoldScalperPro.mq5's DetectRegime() — kept in
// sync deliberately so this panel shows the EA's actual read, not a
// different opinion.
const REGIME_ADX_TREND_MIN = 25;
const REGIME_ADX_RANGE_MAX = 20;
const REGIME_CHOP_TREND_MAX = 38.2;
const REGIME_CHOP_RANGE_MIN = 61.8;

function classifyRegime(adx, choppiness) {
  if (adx == null || choppiness == null) return 'unknown';
  if (adx >= REGIME_ADX_TREND_MIN && choppiness <= REGIME_CHOP_TREND_MAX) return 'trending';
  if (adx <= REGIME_ADX_RANGE_MAX && choppiness >= REGIME_CHOP_RANGE_MIN) return 'ranging';
  return 'unclear';
}

function windowBias(closes, window) {
  const n = closes.length;
  if (n < window + 1) return 'unknown';
  const past = closes[n - window];
  const changePct = ((closes[n - 1] - past) / past) * 100;
  if (changePct > 0.5) return 'up';
  if (changePct < -0.5) return 'down';
  return 'flat';
}

async function fetchOhlc(env, symbol, interval = '5min') {
  const tdSymbol = SYMBOL_MAP[symbol];
  const url = `${TWELVE_DATA_URL}?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=100&apikey=${env.TWELVE_DATA_API_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json();

  if (data && data.status === 'error') {
    throw new Error(`Twelve Data error: ${data.message || 'unknown error'}`);
  }
  if (!res.ok) {
    throw new Error(`http ${res.status}`);
  }
  if (!data || !Array.isArray(data.values) || !data.values.length) {
    throw new Error(`Unexpected Twelve Data response: ${JSON.stringify(data).slice(0, 300)}`);
  }

  const rows = data.values
    .map(v => ({
      date: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close)
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return rows;
}

function analyze(symbol, rows) {
  const n = rows.length;
  const closes = rows.map(r => r.close);
  const highs = rows.map(r => r.high);
  const lows = rows.map(r => r.low);
  const lastPrice = closes[n - 1];

  const sma20 = n >= 20 ? sma(closes, 20) : null;
  const sma50 = n >= 50 ? sma(closes, 50) : null;
  const rsi14 = n >= 15 ? computeRSI(closes) : null;
  const ema9 = n >= 9 ? emaSeries(closes, 9)[n - 1] : null;
  const ema50 = n >= 50 ? emaSeries(closes, 50)[n - 1] : null;
  const macdHistogram = n >= 26 ? computeMACDHistogram(closes) : null;
  const atr14 = n >= 15 ? computeATR(highs, lows, closes) : null;
  const adx14 = n >= 29 ? computeADX(highs, lows, closes) : null;
  const choppiness14 = n >= 15 ? computeChoppinessIndex(highs, lows, closes) : null;
  const regime = classifyRegime(adx14, choppiness14);

  const recentWindow = Math.min(30, n);
  const resistance = Math.max(...highs.slice(-recentWindow));
  const support = Math.min(...lows.slice(-recentWindow));
  const trend = sma50 !== null ? (lastPrice > sma50 ? 'uptrend' : 'downtrend') : 'unknown';

  const round = (v, d) => (v === null || v === undefined || Number.isNaN(v) ? null : Number(v.toFixed(d)));

  return {
    symbol,
    price: round(lastPrice, 2),
    sma20: round(sma20, 2),
    sma50: round(sma50, 2),
    ema9: round(ema9, 2),
    ema50: round(ema50, 2),
    macdHistogram: round(macdHistogram, 4),
    rsi14: round(rsi14, 2),
    atr14: round(atr14, 2),
    adx14: round(adx14, 2),
    choppiness14: round(choppiness14, 2),
    regime,
    support: round(support, 2),
    resistance: round(resistance, 2),
    trend,
    // Keys name the actual lookback at 5-minute candles (5/20/50/90 bars),
    // not calendar days — this used to be daily bars, hence the old "Nd"
    // naming; keep it accurate now that the timeframe changed.
    bias: {
      '25m': n >= 6 ? windowBias(closes, 5) : 'unknown',
      '100m': n >= 21 ? windowBias(closes, 20) : 'unknown',
      '250m': n >= 51 ? windowBias(closes, 50) : 'unknown',
      '450m': n >= 91 ? windowBias(closes, 90) : 'unknown'
    },
    dataPoints: n,
    asOf: new Date().toISOString()
  };
}

async function getFreshTechnical(env, symbol, interval) {
  const rows = await fetchOhlc(env, symbol, interval);
  if (rows.length < 2) throw new Error('Not enough market data returned');
  return analyze(symbol, rows);
}

async function getTechnicalAnalysis(env, symbol, interval = '5min') {
  if (!env.TWELVE_DATA_API_KEY) return { available: false, reason: 'TWELVE_DATA_API_KEY not configured' };
  if (!SYMBOL_MAP[symbol]) return { available: false, reason: `Unsupported symbol: ${symbol}` };

  const cacheKey = `${symbol}:${interval}`;
  const now = Date.now();
  const entry = cache[cacheKey];
  if (entry) {
    const ttl = entry.ok ? CACHE_TTL_SUCCESS_MS : CACHE_TTL_FAILURE_MS;
    if (now - entry.at < ttl) {
      return entry.ok ? { available: true, data: entry.data } : { available: false, reason: entry.reason };
    }
  }

  try {
    const data = await getFreshTechnical(env, symbol, interval);
    cache[cacheKey] = { at: now, ok: true, data };
    return { available: true, data };
  } catch (err) {
    console.error('Technical analysis failed:', err.message);
    cache[cacheKey] = { at: now, ok: false, reason: err.message };
    return { available: false, reason: err.message };
  }
}

// Gold Scalper dashboard's multi-timeframe view: fetches M1/M15/H1 in
// parallel so it can show the same Triple-Screen read (H1 tide, M15 wave,
// M1 entry) the MT5 EA itself trades off of.
async function getMultiTimeframeTechnical(env, symbol) {
  const labels = Object.keys(MULTI_TIMEFRAME_INTERVALS);
  const results = await Promise.all(
    labels.map(label => getTechnicalAnalysis(env, symbol, MULTI_TIMEFRAME_INTERVALS[label]))
  );
  const byTimeframe = {};
  labels.forEach((label, i) => { byTimeframe[label] = results[i]; });
  return byTimeframe;
}

module.exports = { getTechnicalAnalysis, getMultiTimeframeTechnical };
