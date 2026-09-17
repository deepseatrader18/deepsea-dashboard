function summarizeNews(news) {
  if (!news.available) return `News data not available (${news.reason}).`;
  if (!news.data.length) return 'No recent relevant news found.';
  return news.data
    .slice(0, 5)
    .map(n => {
      if (n.country !== undefined) {
        const when = n.date ? new Date(n.date).toISOString() : 'time unknown';
        return `${n.country} — ${n.title} (${when}) — forecast: ${n.forecast ?? 'n/a'}, previous: ${n.previous ?? 'n/a'}, actual: ${n.actual ?? 'not released yet'}`;
      }
      return `${n.title}${n.summary ? ' — ' + n.summary : ''}`;
    })
    .join('\n');
}

function summarizeTechnical(technical) {
  if (!technical.available) return `Technical data not available (${technical.reason}).`;
  const t = technical.data;
  return `Price: ${t.price}, SMA20: ${t.sma20}, SMA50: ${t.sma50}, RSI14: ${t.rsi14}, Support: ${t.support}, Resistance: ${t.resistance}, Trend: ${t.trend}`;
}

async function buildTradePlan(env, { symbol, news, technical }) {
  if (!env.GEMINI_API_KEY) return { available: false, reason: 'Gemini API key not configured' };

  const prompt =
    `You are an experienced trading analyst. The user trades manually and only wants your analysis — ` +
    `they will place the trade themselves, so be specific and actionable.\n\n` +
    `Analyze ${symbol} using the data below.\n\n` +
    `High-impact news this week:\n${summarizeNews(news)}\n\n` +
    `Technical data:\n${summarizeTechnical(technical)}\n\n` +
    'Respond with ONLY a JSON object (no markdown, no extra text) with exactly these keys: ' +
    '"action" (one of "buy", "sell", "hold"), "confidence" (one of "low", "medium", "high"), ' +
    '"entry" (a number: suggested entry price, or null if action is "hold"), ' +
    '"stopLoss" (a number: suggested stop-loss price, or null if action is "hold"), ' +
    '"takeProfit" (a number: suggested take-profit price, or null if action is "hold"), ' +
    '"support" (number or null), "resistance" (number or null), ' +
    '"reasoning" (a 2-3 sentence explanation citing the news and technical data).';

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    const data = await res.json();
    if (!res.ok) {
      console.error('Gemini trade plan error:', JSON.stringify(data));
      return { available: false, reason: data.error?.message || `http ${res.status}` };
    }

    const text =
      (data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text) ||
      '';

    let plan;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      plan = JSON.parse(jsonMatch ? jsonMatch[0] : text);
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
