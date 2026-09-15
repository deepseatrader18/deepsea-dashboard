// Risk Manager Agent: the only agent allowed to decide entry/stop-loss/
// take-profit. It never asks an LLM for these numbers — it derives them
// deterministically from the technical data, then enforces the account's
// risk policy before a trade is ever shown to the user.
//
// Risk policy (set by the account owner, not a default):
//  - Direction comes only from the Chart Agent's technical bias — news is
//    not used to decide or size trades.
//  - Minimum risk:reward is 1:3. A trade that can't clear that bar is never
//    approved — it comes back as "hold" instead.
const MIN_RISK_REWARD = 3;
// Stop-loss distance = ATR14 * ATR_MULTIPLIER (a standard volatility-scaled
// stop), floored so it's never a fraction of a normal day's range and
// capped from below only by a tighter genuine support/resistance level.
const ATR_MULTIPLIER = 1.5;
const MIN_DISTANCE_RATIO = 0.3;
// Used only if ATR14 isn't available yet (e.g. too little price history).
const FALLBACK_RISK_PCT = 0.01;

function biasToDirection(bias) {
  if (bias === 'bullish') return 'buy';
  if (bias === 'bearish') return 'sell';
  return null;
}

function holdResult({ technical, holdReason }) {
  const t = technical.available ? technical.data : {};
  return {
    available: true,
    data: {
      action: 'hold',
      confidence: 'low',
      entry: null,
      stopLoss: null,
      takeProfit: null,
      support: t.support ?? null,
      resistance: t.resistance ?? null,
      riskRewardRatio: null
    },
    holdReason
  };
}

function evaluateRisk({ technical, chartAgent }) {
  if (!technical.available) {
    return { available: false, reason: 'Technical data not available — cannot size a trade' };
  }

  const direction = biasToDirection(chartAgent.data.bias);
  if (!direction) {
    return holdResult({ technical, holdReason: 'Chart Agent shows no clear directional bias' });
  }

  const t = technical.data;
  const price = t.price;

  // Stop distance is bounded by recent volatility (ATR), not a raw 30-day
  // high/low — during a strong trend that extreme can be huge (e.g. gold
  // moving $1000s over a month), which would size the stop far wider than
  // any real trader would risk. A genuine support/resistance level is only
  // used to tighten the stop when it sits *closer* to price than the ATR
  // distance — it can never widen the trade beyond the volatility-scaled
  // amount.
  const atrDistance = typeof t.atr14 === 'number' && t.atr14 > 0 ? t.atr14 * ATR_MULTIPLIER : price * FALLBACK_RISK_PCT;

  let structDistance = null;
  if (direction === 'buy' && typeof t.support === 'number' && t.support < price) {
    structDistance = price - t.support;
  } else if (direction === 'sell' && typeof t.resistance === 'number' && t.resistance > price) {
    structDistance = t.resistance - price;
  }

  let riskDistance = atrDistance;
  if (structDistance != null && structDistance > 0 && structDistance < atrDistance) {
    riskDistance = structDistance;
  }
  const minDistance = atrDistance * MIN_DISTANCE_RATIO;
  if (riskDistance < minDistance) riskDistance = minDistance;

  const stopLoss = direction === 'buy' ? price - riskDistance : price + riskDistance;
  const risk = riskDistance;
  if (!(risk > 0)) {
    return holdResult({ technical, holdReason: 'No usable stop-loss distance could be computed' });
  }

  const reward = risk * MIN_RISK_REWARD;
  const takeProfit = direction === 'buy' ? price + reward : price - reward;

  let confidence = chartAgent.data.confidence;
  if (!['low', 'medium', 'high'].includes(confidence)) confidence = 'low';

  return {
    available: true,
    data: {
      action: direction,
      confidence,
      entry: Number(price.toFixed(2)),
      stopLoss: Number(stopLoss.toFixed(2)),
      takeProfit: Number(takeProfit.toFixed(2)),
      support: t.support ?? null,
      resistance: t.resistance ?? null,
      riskRewardRatio: MIN_RISK_REWARD
    }
  };
}

module.exports = { evaluateRisk, MIN_RISK_REWARD };
