const config = require('../config');

// Discussion Team: same structure as the crypto team's — a Direction
// Debater checks for real agreement between the two researchers, a
// Skeptic hunts for reasons the move might reverse, and a Trend Filter
// blocks counter-trend bets against gold's own broader trend.

function directionCase(researchA, researchB) {
  const agree = researchA.bias === researchB.bias && researchA.bias !== 'neutral';
  const avgConfidence = (researchA.confidence + researchB.confidence) / 2;
  const strongEnough = agree && avgConfidence >= config.MIN_BULL_CONFIDENCE;
  const direction = agree ? (researchA.bias === 'bullish' ? 'long' : 'short') : null;

  return {
    agent: 'Direction Debater',
    direction: strongEnough ? direction : null,
    supportsEntry: strongEnough,
    confidence: strongEnough ? avgConfidence : 0,
    notes: !agree
      ? `No clean agreement — Momentum says ${researchA.bias}, Range says ${researchB.bias}. Not enough to argue for entry.`
      : strongEnough
        ? `Both researchers agree with strong conviction on ${direction === 'long' ? 'bullish' : 'bearish'} bias (momentum ${researchA.confidence}, range ${researchB.confidence}), average ${avgConfidence.toFixed(0)} >= ${config.MIN_BULL_CONFIDENCE} bar.`
        : `Both researchers lean ${researchA.bias} but too weakly (average confidence ${avgConfidence.toFixed(0)} < ${config.MIN_BULL_CONFIDENCE} bar) — skipping a low-conviction signal.`
  };
}

// Skeptic Debater: gold moves in much smaller percentages than crypto per
// candle, so the "chasing" thresholds here are tighter than the crypto
// team's (0.5% / 1 candle vs crypto's 2%) — proportionate to how far gold
// typically moves in a single 5-minute candle.
function skepticCase(candles, direction) {
  const flags = [];
  const closes = candles.map(c => c.close);

  if (closes.length >= 2) {
    const lastCandleMovePct = ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100;
    const chasingLong = direction === 'long' && lastCandleMovePct > 0.5;
    const chasingShort = direction === 'short' && lastCandleMovePct < -0.5;
    if (chasingLong || chasingShort) {
      flags.push(`Single last candle already moved ${lastCandleMovePct.toFixed(2)}% in the direction we'd be trading — high reversal risk right after a spike candle.`);
    }
  }

  if (closes.length >= 4) {
    const last4 = closes.slice(-4);
    const allUp = last4.every((c, i) => i === 0 || c > last4[i - 1]);
    const allDown = last4.every((c, i) => i === 0 || c < last4[i - 1]);
    const cumMovePct = ((last4[3] - last4[0]) / last4[0]) * 100;
    if (direction === 'long' && allUp && cumMovePct > 0.3) {
      flags.push(`Last 3 candles all moved up with no pause (+${cumMovePct.toFixed(2)}% cumulative) — already extended, no pullback confirmation yet.`);
    }
    if (direction === 'short' && allDown && cumMovePct < -0.3) {
      flags.push(`Last 3 candles all moved down with no pause (${cumMovePct.toFixed(2)}% cumulative) — already extended, no bounce confirmation yet.`);
    }
  }

  if (candles.length < 21) {
    flags.push('Not enough recent candle history to trust the read yet.');
  }

  return {
    agent: 'Skeptic Debater',
    blocksEntry: flags.length > 0,
    notes: flags.length ? flags.join(' ') : 'No obvious red flags in the recent price shape.'
  };
}

// Trend Filter: only trade WITH the broader trend (EMA50 vs EMA200 on the
// same 5-minute series) — a long against a bearish broader trend, or a
// short against a bullish one, is a counter-trend bet more likely to
// reverse than hold. Mirrors the crypto team's BTC trend filter, but reads
// gold's own longer-term trend directly since there's no "market leader"
// coin equivalent for a single instrument.
function trendCase(direction, candles) {
  const closes = candles.map(c => c.close);
  if (closes.length < 200) {
    return { agent: 'Trend Filter', blocksEntry: false, notes: 'Not enough history yet for the broader trend read — proceeding without this check.' };
  }
  function emaFull(values, period) {
    const k = 2 / (period + 1);
    let e = values[0];
    for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
    return e;
  }
  const ema50 = emaFull(closes.slice(-50), 50);
  const ema200 = emaFull(closes.slice(-200), 200);
  const bias = ema50 > ema200 ? 'bullish' : ema50 < ema200 ? 'bearish' : 'neutral';
  const counterTrend = (direction === 'long' && bias === 'bearish') || (direction === 'short' && bias === 'bullish');
  return {
    agent: 'Trend Filter',
    blocksEntry: counterTrend,
    notes: `Broader (EMA50/EMA200) trend is ${bias}.${counterTrend ? ` Skipping — a ${direction} here would be counter-trend to the broader market.` : ''}`
  };
}

function discuss({ researchA, researchB, candles }) {
  const direction = directionCase(researchA, researchB);
  if (!direction.supportsEntry) {
    return {
      proceed: false,
      direction: null,
      confidence: 0,
      bull: direction,
      reasoning: `Discussion Team: hold. ${direction.notes}`
    };
  }

  const skeptic = skepticCase(candles, direction.direction);
  const trend = trendCase(direction.direction, candles);
  const proceed = !skeptic.blocksEntry && !trend.blocksEntry;

  return {
    proceed,
    direction: proceed ? direction.direction : null,
    confidence: proceed ? direction.confidence : 0,
    bull: direction,
    skeptic,
    trend,
    reasoning: proceed
      ? `Discussion Team: proceed (${direction.direction}). ${direction.notes} Skeptic check clear: ${skeptic.notes} Trend check: ${trend.notes}`
      : `Discussion Team: hold. ${skeptic.blocksEntry ? skeptic.notes : ''} ${trend.blocksEntry ? trend.notes : ''}`.trim()
  };
}

module.exports = { discuss };
