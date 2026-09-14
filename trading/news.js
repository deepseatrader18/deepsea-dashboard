const FF_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const RAPIDAPI_HOST = 'forex-factory-news.p.rapidapi.com';

async function getFromPublicCalendar() {
  try {
    const res = await fetch(FF_CALENDAR_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DeepSeaDashboard/1.0)' }
    });
    if (!res.ok) {
      console.error(`Forex Factory public calendar fetch failed: http ${res.status}`);
      return { available: false, reason: `http ${res.status}` };
    }
    const events = await res.json();
    if (!Array.isArray(events)) return { available: false, reason: 'unexpected response shape' };

    const highImpact = events
      .filter(e => e && String(e.impact).toLowerCase() === 'high')
      .map(e => ({
        title: e.title || '(untitled)',
        country: e.country || '',
        forecast: e.forecast || null,
        previous: e.previous || null
      }));

    return { available: true, data: highImpact };
  } catch (err) {
    console.error('Forex Factory public calendar fetch failed:', err.message);
    return { available: false, reason: err.message };
  }
}

async function getFromRapidApi(rapidApiKey) {
  try {
    const res = await fetch(`https://${RAPIDAPI_HOST}/news`, {
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`Forex Factory RapidAPI fetch failed: http ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
      return { available: false, reason: `http ${res.status}` };
    }

    const json = await res.json();
    const items = json.stories || json.items || json.results || json.news || (Array.isArray(json.data) ? json.data : null);

    if (!Array.isArray(items)) {
      console.error('Forex Factory RapidAPI unexpected response shape:', JSON.stringify(json).slice(0, 500));
      return { available: false, reason: 'unexpected response shape' };
    }

    const news = items.slice(0, 10).map(item => ({
      title: item.title || item.headline || '(untitled)',
      time: item.time || item.date || item.published || null,
      summary: item.summary || item.description || item.body || null
    }));

    return { available: true, data: news };
  } catch (err) {
    console.error('Forex Factory RapidAPI fetch failed:', err.message);
    return { available: false, reason: err.message };
  }
}

async function getForexFactoryNews(env) {
  if (env && env.RAPIDAPI_KEY) {
    return getFromRapidApi(env.RAPIDAPI_KEY);
  }
  return getFromPublicCalendar();
}

module.exports = { getForexFactoryNews };
