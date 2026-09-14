function formatNewsForPrompt(news) {
  return news.data
    .slice(0, 8)
    .map(n => {
      if (n.country !== undefined) {
        return `${n.country} — ${n.title} (forecast: ${n.forecast ?? 'n/a'}, previous: ${n.previous ?? 'n/a'})`;
      }
      return `${n.title}${n.summary ? ' — ' + n.summary : ''}`;
    })
    .join('\n');
}

// News Analysis Agent: reads the raw news/economic-calendar data and produces
// a directional bias. This is the only agent in the pipeline that calls an
// LLM on unstructured text — the Risk Manager never lets it touch numbers.
async function analyzeNews(env, { symbol, news }) {
  if (!news.available || !news.data || !news.data.length) {
    return { available: true, data: { bias: 'neutral', confidence: 'low', summary: 'No notable news available.' }, reason: null };
  }
  if (!env.GEMINI_API_KEY) {
    return { available: false, data: { bias: 'neutral', confidence: 'low', summary: 'News Agent unavailable (Gemini API key not configured).' }, reason: 'Gemini API key not configured' };
  }

  const prompt =
    `You are the News Analysis Agent inside a trading risk system. Analyze the following high-impact news / ` +
    `economic events for their likely short-term directional impact on ${symbol}.\n\n${formatNewsForPrompt(news)}\n\n` +
    'Respond with ONLY a JSON object (no markdown, no extra text) with exactly these keys: ' +
    '"bias" (one of "bullish", "bearish", "neutral" for the symbol price), ' +
    '"confidence" (one of "low", "medium", "high"), ' +
    '"summary" (1-2 sentences explaining the call, citing the specific news items). ' +
    'If the news is mixed or none of it clearly moves this symbol, use "neutral" — do not force a direction.';

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    const data = await res.json();
    if (!res.ok) {
      console.error('News Agent error:', JSON.stringify(data));
      return { available: false, data: { bias: 'neutral', confidence: 'low', summary: 'News Agent request failed.' }, reason: data.error?.message || `http ${res.status}` };
    }

    const text =
      (data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text) ||
      '';

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (parseErr) {
      console.error('News Agent JSON parse failed:', text);
      return { available: false, data: { bias: 'neutral', confidence: 'low', summary: 'Could not parse News Agent response.' }, reason: 'Could not parse News Agent response' };
    }

    if (!['bullish', 'bearish', 'neutral'].includes(parsed.bias)) parsed.bias = 'neutral';
    if (!['low', 'medium', 'high'].includes(parsed.confidence)) parsed.confidence = 'low';

    return { available: true, data: parsed, reason: null };
  } catch (err) {
    console.error('News Agent fetch failed:', err.message);
    return { available: false, data: { bias: 'neutral', confidence: 'low', summary: 'News Agent request failed.' }, reason: err.message };
  }
}

module.exports = { analyzeNews };
