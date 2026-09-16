const config = require('../config');
const marketFilter = require('../marketFilter');

// Discussion Team: two agents debate the Research Team's two independent
// reads before anything reaches Portfolio Management. One argues the case
// for entering (long OR short — Futures allows both), one actively hunts
// for reasons not to. A volume surge is exactly the kind of signal a
// pump-and-dump (or its mirror, a dump-and-pump) can fake, so the Skeptic
// Debater's job is specifically to catch that, regardless of direction.

// Direction Debater: is there real, strong-enough agreement between the
// two researchers, and which way does it point? Fewer, higher-conviction
// trades beats acting on every borderline signal — a weak-confidence
// agreement is exactly what was producing losers.
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
      ? `No clean agreement — Momentum says ${researchA.bias}, Volume says ${researchB.bias}. Not enough to argue for entry.`
      : strongEnough
        ? `Both researchers agree with strong conviction on ${direction === 'long' ? 'bullish' : 'bearish'} bias (momentum ${researchA.confidence}, volume ${researchB.confidence}), average ${avgConfidence.toFixed(0)} >= ${config.MIN_BULL_CONFIDENCE} bar.`
        : `Both researchers lean ${researchA.bias} but too weakly (average confidence ${avgConfidence.toFixed(0)} < ${config.MIN_BULL_CONFIDENCE} bar) — skipping a low-conviction signal.`
  };
}

// Skeptic Debater: red-flags that make a volume spike untrustworthy even
// when the researchers agree — a single-candle vertical move, an already
// extended run in the SAME direction we're about to trade (chasing), or
// thin recent history. Direction-aware: an extended move already up is a
// red flag for a fresh LONG (buying the top) but not for a SHORT (that's
// the setup), and vice versa.
function skepticCase(surge, klines, direction) {
  const flags = [];

  if (Math.abs(surge.priceChangePct) > 10) {
    flags.push(`24h move already ${surge.priceChangePct.toFixed(1)}% — likely chasing an extended move.`);
  }

  const closes = klines.map(k => parseFloat(k[4]));
  if (closes.length >= 2) {
    const lastCandleMovePct = ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100;
    const chasingLong = direction === 'long' && lastCandleMovePct > 2;
    const chasingShort = direction === 'short' && lastCandleMovePct < -2;
    if (chasingLong || chasingShort) {
      flags.push(`Single last candle already moved ${lastCandleMovePct.toFixed(1)}% in the direction we'd be trading — classic pump-candle shape, high reversal risk.`);
    }
  }

  // A run of several consecutive candles already moving the way we'd be
  // trading means the move is already extended — exactly the "chase the
  // top/bottom" pattern that was hitting stops. Require at least one
  // pause among the last 3 candles before trusting a fresh breakout.
  if (closes.length >= 4) {
    const last4 = closes.slice(-4);
    const allUp = last4.every((c, i) => i === 0 || c > last4[i - 1]);
    const allDown = last4.every((c, i) => i === 0 || c < last4[i - 1]);
    const cumMovePct = ((last4[3] - last4[0]) / last4[0]) * 100;
    if (direction === 'long' && allUp && cumMovePct > 1) {
      flags.push(`Last 3 candles all moved up with no pause (+${cumMovePct.toFixed(1)}% cumulative) — already extended, no confirmation of a pullback yet.`);
    }
    if (direction === 'short' && allDown && cumMovePct < -1) {
      flags.push(`Last 3 candles all moved down with no pause (${cumMovePct.toFixed(1)}% cumulative) — already extended, no confirmation of a bounce yet.`);
    }
  }

  if (surge.surgeMultiple != null && surge.surgeMultiple > 8) {
    flags.push(`Volume spike is ${surge.surgeMultiple.toFixed(1)}x baseline — unusually extreme, treat with extra caution.`);
  }

  if (klines.length < 21) {
    flags.push('Not enough recent candle history to trust the read yet.');
  }

  return {
    agent: 'Skeptic Debater',
    blocksEntry: flags.length > 0,
    notes: flags.length ? flags.join(' ') : 'No obvious red flags in the recent price/volume shape.'
  };
}

// Market Filter: most altcoins move with Bitcoin most of the time — only
// trade WITH BTC's own trend, not against it. A long when BTC is bearish,
// or a short when BTC is bullish, is a counter-trend bet that's more
// likely to reverse against the alt than hold its own independent move.
function marketCase(direction) {
  const trend = marketFilter.getBtcTrend();
  const counterTrend = (direction === 'long' && trend.bias === 'bearish') || (direction === 'short' && trend.bias === 'bullish');
  return {
    agent: 'Market Filter',
    blocksEntry: counterTrend,
    notes: trend.bias === 'unknown'
      ? 'BTC trend not available yet — proceeding without this check.'
      : `BTC 5m trend is ${trend.bias}.${counterTrend ? ` Skipping — a ${direction} here would be counter-trend to the broader market.` : ''}`
  };
}

// Consolidated discussion verdict handed to Portfolio Management.
function discuss({ researchA, researchB, surge, klines }) {
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

  const skeptic = skepticCase(surge, klines, direction.direction);
  const market = marketCase(direction.direction);
  const proceed = !skeptic.blocksEntry && !market.blocksEntry;

  return {
    proceed,
    direction: proceed ? direction.direction : null,
    confidence: proceed ? direction.confidence : 0,
    bull: direction,
    skeptic,
    market,
    reasoning: proceed
      ? `Discussion Team: proceed (${direction.direction}). ${direction.notes} Skeptic check clear: ${skeptic.notes} Market check: ${market.notes}`
      : `Discussion Team: hold. ${skeptic.blocksEntry ? skeptic.notes : ''} ${market.blocksEntry ? market.notes : ''}`.trim()
  };
}

module.exports = { discuss };
