const { analyzeNews } = require('./newsAgent');
const { analyzeChart } = require('./chartAgent');
const { evaluateRisk } = require('./riskManager');
const { finalizePlan } = require('./generalManager');

// News Agent + Chart Agent run in parallel, feed the Risk Manager (which
// decides direction, levels, and approve/reject against the risk policy),
// which feeds the General Manager (which packages the final trade plan).
async function runTradingPipeline(env, { symbol, news, technical }) {
  const [newsAgent, chartAgent] = await Promise.all([
    analyzeNews(env, { symbol, news }),
    Promise.resolve(analyzeChart({ technical }))
  ]);

  const risk = evaluateRisk({ technical, newsAgent, chartAgent });
  const plan = finalizePlan({ symbol, newsAgent, chartAgent, risk });

  return { plan, newsAgent, chartAgent, risk };
}

module.exports = { runTradingPipeline };
