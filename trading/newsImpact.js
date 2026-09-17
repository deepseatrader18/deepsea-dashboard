// AI research layer on top of the real Economic Calendar feed: for each
// real event (real title/time/forecast/previous/actual — never invented),
// asks Gemini which trading instruments it's likely to move and why. This
// is explicitly a reasoning/analysis layer, not another data feed — the
// underlying facts always come from trading/news.js's real calendar data.
//
// Re-analyzing every event on every poll would burn Gemini quota for no
// reason, so each event is only re-sent once its `actual` value changes
// (i.e. exactly when the release happens) — otherwise the cached read is
// reused.

const INSTRUMENTS = ['XAUUSD', 'BTCUSD', 'EURUSD', 'GBPUSD'];

let impactCache = new Map(); // eventKey -> { actual, affects }

function eventKey(item) {
  return `${item.country}|${item.title}|${item.date || ''}`;
}

function buildImpactPrompt(events) {
  const list = events.map((e, i) => ({
    index: i,
    country: e.country,
    title: e.title,
    time: e.date,
    forecast: e.forecast,
    previous: e.previous,
    actual: e.actual
  }));

  return (
    'You are a market analyst. The data below is real, factual economic-calendar data — never invent, alter, or guess at any of these numbers, only reason about them.\n\n' +
    `For EACH event, decide which of these instruments it is likely to move: ${INSTRUMENTS.join(', ')} (gold, bitcoin, EUR/USD, GBP/USD). ` +
    "If the event's actual result is present, base the direction on actual vs forecast/previous (a beat or a miss). " +
    'If actual is not yet released, base it on general pre-release positioning from forecast vs previous, or use direction "awaiting release" if there is no reasonable pre-release read. ' +
    'Only include instruments that are plausibly affected by this specific event — omit unrelated ones entirely (most events should affect 0-2 instruments, not all four).\n\n' +
    `Events:\n${JSON.stringify(list)}\n\n` +
    'Respond with ONLY a JSON array (no markdown, no extra text), one object per event, each with exactly these keys: ' +
    '"index" (matching the input index), "affects" (an array of objects, each with "symbol", ' +
    '"direction" — one of "bullish", "bearish", "neutral", "awaiting release" — and "reason", a single short sentence).'
  );
}

async function callGemini(env, prompt) {
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
    throw new Error(data.error?.message || `http ${res.status}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text);
}

// Takes today's real calendar events (from getEconomicCalendar) and returns
// the same events annotated with `impact: { affects: [...] } | null`.
// `impact` is null when analysis hasn't run yet or failed — the frontend
// must treat that as "no AI read available", never fabricate one.
async function analyzeNewsImpact(env, events) {
  if (!Array.isArray(events) || !events.length) return [];

  // Drop cache entries for events that are no longer in today's list
  // (yesterday's events, mainly) so this doesn't grow without bound.
  const currentKeys = new Set(events.map(eventKey));
  for (const key of impactCache.keys()) {
    if (!currentKeys.has(key)) impactCache.delete(key);
  }

  if (!env || !env.GEMINI_API_KEY) {
    return events.map(e => ({ ...e, impact: null }));
  }

  const toAnalyze = [];
  const results = new Array(events.length).fill(null);

  events.forEach((e, i) => {
    const key = eventKey(e);
    const cached = impactCache.get(key);
    if (cached && cached.actual === (e.actual ?? null)) {
      results[i] = { ...e, impact: { affects: cached.affects } };
    } else {
      toAnalyze.push({ originalIndex: i, event: e });
    }
  });

  if (toAnalyze.length) {
    try {
      const prompt = buildImpactPrompt(toAnalyze.map(t => t.event));
      const parsed = await callGemini(env, prompt);
      parsed.forEach(item => {
        const t = toAnalyze[item.index];
        if (!t) return;
        const affects = Array.isArray(item.affects) ? item.affects : [];
        impactCache.set(eventKey(t.event), { actual: t.event.actual ?? null, affects });
        results[t.originalIndex] = { ...t.event, impact: { affects } };
      });
    } catch (err) {
      console.error('News impact analysis failed:', err.message);
    }
  }

  return results.map((r, i) => r || { ...events[i], impact: null });
}

module.exports = { analyzeNewsImpact };
