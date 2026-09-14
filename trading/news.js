const cheerio = require('cheerio');

const FF_NEWS_PAGE = 'https://www.forexfactory.com/news';
const FF_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const RAPIDAPI_HOST = 'forex-factory-news.p.rapidapi.com';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CACHE_TTL_SUCCESS_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_TTL_FAILURE_MS = 2 * 60 * 1000; // retry sooner after a failure
let cache = { at: 0, result: null };

// Free, keyless economic calendar feed — the primary source, since it has
// worked reliably in practice (unlike forexfactory.com's own site, which
// blocks requests from cloud/datacenter IPs the same way Yahoo Finance does).
async function getFromPublicCalendar() {
  try {
    const res = await fetch(FF_CALENDAR_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': BROWSER_USER_AGENT }
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

// Best-effort direct scrape of the page the user actually looks at. Render's
// datacenter IP gets a 403 from forexfactory.com's own bot protection as of
// this writing, so this is kept only as a secondary attempt in case that
// ever changes, not relied on.
async function getFromForexFactoryPage() {
  try {
    const res = await fetch(FF_NEWS_PAGE, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      console.error(`Forex Factory page fetch failed: http ${res.status}`);
      return { available: false, reason: `http ${res.status}` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const seen = new Set();
    const items = [];
    $('a[href^="/news/"]').each((_, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr('href');
      if (!title || title.length < 8 || seen.has(href)) return;
      seen.add(href);
      items.push({ title });
    });

    if (!items.length) {
      console.error(`Forex Factory page scrape found 0 items (page structure may have changed). HTML length: ${html.length}`);
      return { available: false, reason: 'no news items found on page' };
    }

    return { available: true, data: items.slice(0, 15) };
  } catch (err) {
    console.error('Forex Factory page fetch failed:', err.message);
    return { available: false, reason: err.message };
  }
}

// Kept for when the correct RapidAPI endpoint path is confirmed — every
// guessed path has 404'd so far, so this rarely succeeds today.
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
    const items = json.items || json.stories || json.results || json.news || (Array.isArray(json.data) ? json.data : null);

    if (!Array.isArray(items)) {
      console.error('Forex Factory RapidAPI unexpected response shape:', JSON.stringify(json).slice(0, 500));
      return { available: false, reason: 'unexpected response shape' };
    }

    const news = items.slice(0, 15).map(item => ({
      title: (item.title || item.headline || '(untitled)').replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      ),
      source: item.source || null,
      impact: item.impact || null
    }));

    return { available: true, data: news };
  } catch (err) {
    console.error('Forex Factory RapidAPI fetch failed:', err.message);
    return { available: false, reason: err.message };
  }
}

async function fetchForexFactoryNews(env) {
  const calendar = await getFromPublicCalendar();
  if (calendar.available) return calendar;

  const page = await getFromForexFactoryPage();
  if (page.available) return page;

  if (env && env.RAPIDAPI_KEY) {
    const rapid = await getFromRapidApi(env.RAPIDAPI_KEY);
    if (rapid.available) return rapid;
  }

  return calendar; // return the (unavailable) calendar result — carries the most useful `reason`
}

// The dashboard polls /api/status every 15s, and each trade-plan request
// also calls this — without caching that hammers these external services
// often enough to get us rate-limited. Cache the outcome for a few minutes.
async function getForexFactoryNews(env) {
  const now = Date.now();
  const ttl = cache.result && cache.result.available ? CACHE_TTL_SUCCESS_MS : CACHE_TTL_FAILURE_MS;
  if (cache.result && now - cache.at < ttl) {
    return cache.result;
  }
  const result = await fetchForexFactoryNews(env);
  cache = { at: now, result };
  return result;
}

module.exports = { getForexFactoryNews };
