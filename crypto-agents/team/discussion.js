// Discussion Team: two agents debate the Research Team's two independent
// reads before anything reaches Portfolio Management. One argues the case
// for entering, one actively hunts for reasons not to — a volume surge on
// an exchange is exactly the kind of signal a pump-and-dump can fake, so
// the Skeptic Debater's job is specifically to catch that.

// Bull Debater: is there actual agreement between the two researchers?
function bullCase(researchA, researchB) {
  const agree = researchA.bias === researchB.bias && researchA.bias === 'bullish';
  const avgConfidence = (researchA.confidence + researchB.confidence) / 2;
  return {
    agent: 'Bull Debater',
    supportsEntry: agree,
    confidence: agree ? avgConfidence : 0,
    notes: agree
      ? `Both researchers agree: bullish momentum (${researchA.confidence}) and bullish volume (${researchB.confidence}).`
      : `No clean agreement — Momentum says ${researchA.bias}, Volume says ${researchB.bias}. Not enough to argue for entry.`
  };
}

// Skeptic Debater: red-flags that make a volume spike untrustworthy even
// when the researchers agree — a single-candle vertical move, an already
// extended 24h gain (chasing), or thin recent history.
function skepticCase(surge, klines) {
  const flags = [];

  if (Math.abs(surge.priceChangePct) > 15) {
    flags.push(`24h move already ${surge.priceChangePct.toFixed(1)}% — likely chasing an extended move.`);
  }

  const closes = klines.map(k => parseFloat(k[4]));
  if (closes.length >= 2) {
    const lastCandleMovePct = ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100;
    if (Math.abs(lastCandleMovePct) > 4) {
      flags.push(`Single last candle already moved ${lastCandleMovePct.toFixed(1)}% — classic pump-candle shape, high reversal risk.`);
    }
  }

  if (surge.surgeMultiple != null && surge.surgeMultiple > 15) {
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
  const proceed = bull.supportsEntry && !skeptic.blocksEntry;

  return {
    proceed,
    confidence: proceed ? bull.confidence : 0,
    bull,
    skeptic,
    reasoning: proceed
      ? `Discussion Team: proceed. ${bull.notes} Skeptic check clear: ${skeptic.notes}`
      : `Discussion Team: hold. ${!bull.supportsEntry ? bull.notes : ''} ${skeptic.blocksEntry ? skeptic.notes : ''}`.trim()
  };
}

module.exports = { discuss };
