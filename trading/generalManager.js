// Trading General Manager Agent: the last stop before the dashboard and
// DeepSea chat. It never changes a number the Risk Manager set — it only
// packages the pipeline's output into the shape the rest of the app expects
// and writes the human-readable reasoning.
function finalizePlan({ symbol, chartAgent, risk }) {
  if (!risk.available) {
    return { available: false, reason: risk.reason || 'Risk Manager could not evaluate this trade' };
  }

  const d = risk.data;

  if (d.action === 'hold') {
    const why = risk.holdReason || 'No clear technical edge strong enough to size a trade within this account\'s risk policy.';
    return {
      available: true,
      data: {
        action: 'hold',
        confidence: 'low',
        entry: null,
        stopLoss: null,
        takeProfit: null,
        support: d.support,
        resistance: d.resistance,
        reasoning: `Hold — ${why}. Chart Agent: ${chartAgent.data.bias} (${chartAgent.data.confidence}).`
      }
    };
  }

  const rr = `1:${d.riskRewardRatio}`;
  const reasoning =
    `${d.action.toUpperCase()} ${symbol}. ` +
    `Chart Agent: ${chartAgent.data.bias} (${chartAgent.data.confidence}) — ${chartAgent.data.summary || 'no summary'} ` +
    `Risk Manager sized the stop from recent volatility (ATR), tightened to a closer support/resistance ` +
    `level when one exists, and set take-profit for a strict ${rr} risk:reward — this trade is only shown because it clears that bar.`;

  return {
    available: true,
    data: {
      action: d.action,
      confidence: d.confidence,
      entry: d.entry,
      stopLoss: d.stopLoss,
      takeProfit: d.takeProfit,
      support: d.support,
      resistance: d.resistance,
      riskRewardRatio: d.riskRewardRatio,
      reasoning
    }
  };
}

module.exports = { finalizePlan };
