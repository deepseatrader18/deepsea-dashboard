// Risk Manager Agent: the only agent allowed to decide entry/stop-loss/
// take-profit. It never asks an LLM for these numbers — it derives them
// deterministically from the technical data, then enforces the account's
// risk policy before a trade is ever shown to the user.
//
// Risk policy (set by the account owner, not a default):
//  - Minimum risk:reward is 1:3. A trade that can't clear that bar is never
//    approved — it comes back as "hold" instead.
//  - When the News Agent and Chart Agent disagree on direction, News wins
//    (news is the priority signal for this account), but the disagreement
//    caps confidence so a "high" call never survives a real conflict.
const MIN_RISK_REWARD = 3;

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
      directionSource: null,
      conflict: false,
      riskRewardRatio: null
    },
    holdReason
  };
}

function evaluateRisk({ technical, newsAgent, chartAgent }) {
  if (!technical.available) {
    return { available: false, reason: 'Technical data not available — cannot size a trade' };
  }

  const newsDirection = biasToDirection(newsAgent.data.bias);
  const chartDirection = biasToDirection(chartAgent.data.bias);

  const conflict = Boolean(newsDirection && chartDirection && newsDirection !== chartDirection);

  let direction = null;
  let directionSource = null;
  if (newsDirection) {
    direction = newsDirection;
    directionSource = 'news';
  } else if (chartDirection) {
    direction = chartDirection;
    directionSource = 'chart';
  }

  if (!direction) {
    return holdResult({ technical, holdReason: 'Neither News Agent nor Chart Agent shows a clear directional bias' });
  }

  const t = technical.data;
  const price = t.price;

  let stopLoss;
  if (direction === 'buy') {
    stopLoss = typeof t.support === 'number' && t.support < price ? t.support : price * 0.99;
  } else {
    stopLoss = typeof t.resistance === 'number' && t.resistance > price ? t.resistance : price * 1.01;
  }

  const risk = Math.abs(price - stopLoss);
  if (!(risk > 0) || risk / price < 0.0005) {
    return holdResult({ technical, holdReason: 'No usable structural stop-loss level near the current price' });
  }

  const reward = risk * MIN_RISK_REWARD;
  const takeProfit = direction === 'buy' ? price + reward : price - reward;

  let confidence = directionSource === 'news' ? newsAgent.data.confidence : chartAgent.data.confidence;
  if (!['low', 'medium', 'high'].includes(confidence)) confidence = 'low';
  if (conflict && confidence === 'high') confidence = 'medium';

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
      directionSource,
      conflict,
      riskRewardRatio: MIN_RISK_REWARD
    }
  };
}

module.exports = { evaluateRisk, MIN_RISK_REWARD };
