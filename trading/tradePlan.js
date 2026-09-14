function summarizeNews(news) {
  if (!news.available) return `News data not available (${news.reason}).`;
  if (!news.data.length) return 'No major high-impact news scheduled this week.';
  return news.data
    .slice(0, 5)
    .map(n => `${n.country} — ${n.title} (forecast: ${n.forecast ?? 'n/a'}, previous: ${n.previous ?? 'n/a'})`)
    .join('\n');
}

function summarizeTechnical(technical) {
  if (!technical.available) return `Technical data not available (${technical.reason}).`;
  const t = technical.data;
  return `Price: ${t.price}, SMA20: ${t.sma20}, SMA50: ${t.sma50}, RSI14: ${t.rsi14}, Support: ${t.support}, Resistance: ${t.resistance}, Trend: ${t.trend}`;
}

async function buildTradePlan(env, { symbol, news, technical }) {
  if (!env.OPENAI_API_KEY) return { available: false, reason: 'OpenAI API key not configured' };

  const prompt =
    `You are a trading analyst assistant. Analyze ${symbol} using the data below and propose a trade plan.\n\n` +
    `High-impact news this week:\n${summarizeNews(news)}\n\n` +
    `Technical data:\n${summarizeTechnical(technical)}\n\n` +
    'Respond with ONLY a JSON object (no markdown, no extra text) with exactly these keys: ' +
    '"action" (one of "buy", "sell", "hold"), "confidence" (one of "low", "medium", "high"), ' +
    '"support" (number or null), "resistance" (number or null), "reasoning" (a 2-3 sentence explanation).';

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(20000)
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('OpenAI trade plan error:', JSON.stringify(data));
      return { available: false, reason: data.error?.message || `http ${res.status}` };
    }

    const text = data.choices?.[0]?.message?.content || '';
    let plan;
    try {
      plan = JSON.parse(text);
    } catch (parseErr) {
      console.error('Trade plan JSON parse failed:', text);
      return { available: false, reason: 'Could not parse trade plan response' };
    }

    return { available: true, data: plan };
  } catch (err) {
    console.error('Trade plan generation failed:', err.message);
    return { available: false, reason: err.message };
  }
}

module.exports = { buildTradePlan };
