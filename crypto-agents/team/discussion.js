const config = require('../config');
const marketFilter = require('../marketFilter');

// Discussion Team: two agents debate the Research Team's two independent
// reads before anything reaches Portfolio Management. One argues the case
// for entering, one actively hunts for reasons not to — a volume surge on
// an exchange is exactly the kind of signal a pump-and-dump can fake, so
// the Skeptic Debater's job is specifically to catch that.

// Bull Debater: is there actual agreement between the two researchers, and
// is it a strong enough read to act on? Fewer, higher-conviction trades
// beats trading every borderline signal — a weak-confidence agreement
// (e.g. both researchers barely lean bullish) is exactly the kind of
// signal that was producing losers.
function bullCase(researchA, researchB) {
  const agree = researchA.bias === researchB.bias && researchA.bias === 'bullish';
  const avgConfidence = (researchA.confidence + researchB.confidence) / 2;
  const strongEnough = agree && avgConfidence >= config.MIN_BULL_CONFIDENCE;
  return {
    agent: 'Bull Debater',
    supportsEntry: strongEnough,
    confidence: strongEnough ? avgConfidence : 0,
    notes: !agree
      ? `No clean agreement — Momentum says ${researchA.bias}, Volume says ${researchB.bias}. Not enough to argue for entry.`
      : strongEnough
        ? `Both researchers agree with strong conviction: bullish momentum (${researchA.confidence}) and bullish volume (${researchB.confidence}), average ${avgConfidence.toFixed(0)} >= ${config.MIN_BULL_CONFIDENCE} bar.`
        : `Both researchers lean bullish but too weakly (average confidence ${avgConfidence.toFixed(0)} < ${config.MIN_BULL_CONFIDENCE} bar) — skipping a low-conviction signal.`
  };
}

// Market Filter: most altcoins move with Bitcoin most of the time — a
// bullish signal on some other coin means far less if BTC itself is
// trending down right now, since the alt is more likely to reverse with
// it than hold its own move.
function marketCase() {
  const trend = marketFilter.getBtcTrend();
  const blocksEntry = trend.bias === 'bearish';
  return {
    agent: 'Market Filter',
    blocksEntry,
    notes: trend.bias === 'unknown'
      ? 'BTC trend not available yet — proceeding without this check.'
      : `BTC 5m trend is ${trend.bias}.${blocksEntry ? ' Skipping — broader market is trending down, alt longs are more likely to reverse with it.' : ''}`
  };
}

// Skeptic Debater: red-flags that make a volume spike untrustworthy even
// when the researchers agree — a single-candle vertical move, an already
// extended run, or thin recent history. Tightened after real paper-trading
// results showed most entries were buying the exact top of a spike right
// before it pulled back into the stop-loss — these thresholds are
// deliberately stricter than a first pass would guess.
function skepticCase(surge, klines) {
  const flags = [];

  if (Math.abs(surge.priceChangePct) > 10) {
    flags.push(`24h move already ${surge.priceChangePct.toFixed(1)}% — likely chasing an extended move.`);
  }

  const closes = klines.map(k => parseFloat(k[4]));
  if (closes.length >= 2) {
    const lastCandleMovePct = ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100;
    if (Math.abs(lastCandleMovePct) > 2) {
      flags.push(`Single last candle already moved ${lastCandleMovePct.toFixed(1)}% — classic pump-candle shape, high reversal risk.`);
    }
  }

  // A run of several consecutive up-candles right before entry means the
  // move is already extended — exactly the "buy the top" pattern that was
  // hitting stop-losses. Require at least one of the last 3 candles to
  // have been flat/red, i.e. some pause, before trusting a fresh breakout.
  if (closes.length >= 4) {
    const last4 = closes.slice(-4);
    const allUp = last4.every((c, i) => i === 0 || c > last4[i - 1]);
    const cumMovePct = ((last4[3] - last4[0]) / last4[0]) * 100;
    if (allUp && cumMovePct > 1) {
      flags.push(`Last 3 candles all moved up with no pause (+${cumMovePct.toFixed(1)}% cumulative) — already extended, no confirmation of a pullback yet.`);
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

// Consolidated discussion verdict handed to Portfolio Management.
function discuss({ researchA, researchB, surge, klines }) {
  const bull = bullCase(researchA, researchB);
  const skeptic = skepticCase(surge, klines);
  const market = marketCase();
  const proceed = bull.supportsEntry && !skeptic.blocksEntry && !market.blocksEntry;

  return {
    proceed,
    confidence: proceed ? bull.confidence : 0,
    bull,
    skeptic,
    market,
    reasoning: proceed
      ? `Discussion Team: proceed. ${bull.notes} Skeptic check clear: ${skeptic.notes} Market check: ${market.notes}`
      : `Discussion Team: hold. ${!bull.supportsEntry ? bull.notes : ''} ${skeptic.blocksEntry ? skeptic.notes : ''} ${market.blocksEntry ? market.notes : ''}`.trim()
  };
}

module.exports = { discuss };
