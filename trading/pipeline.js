const { analyzeChart } = require('./chartAgent');
const { evaluateRisk } = require('./riskManager');
const { finalizePlan } = require('./generalManager');

// Chart Agent feeds the Risk Manager (which decides direction, levels, and
// approve/reject against the risk policy), which feeds the General Manager
// (which packages the final trade plan). Trade decisions are driven only by
// technical/chart analysis — news is not part of this pipeline.
async function runTradingPipeline(env, { symbol, technical }) {
  const chartAgent = analyzeChart({ technical });
  const risk = evaluateRisk({ technical, chartAgent });
  const plan = finalizePlan({ symbol, chartAgent, risk });

  return { plan, chartAgent, risk };
}

module.exports = { runTradingPipeline };
