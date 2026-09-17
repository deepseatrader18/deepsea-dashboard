const cheerio = require('cheerio');

const FF_NEWS_PAGE = 'https://www.forexfactory.com/news';
const FF_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const RAPIDAPI_HOST = 'forex-factory-news.p.rapidapi.com';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CACHE_TTL_SUCCESS_MS = 3 * 60 * 1000; // the user wants results to show up promptly after release
const CACHE_TTL_FAILURE_MS = 2 * 60 * 1000; // retry sooner after a failure
let cache = { at: 0, result: null };

// The raw calendar feed is hit from two independent places (the general news
// context below, and the Economic Calendar panel/dashboard) — without a
// SHARED cache underneath both, they each poll the upstream feed on their
// own schedule and the combined rate gets our IP 429'd by the free feed, as
// happened in production. This is the single choke point every consumer of
// the public calendar goes through, so the feed is only actually fetched
// once per TTL window no matter how many features read it.
const RAW_CALENDAR_CACHE_TTL_MS = 30 * 1000;
const RAW_CALENDAR_FAILURE_BASE_MS = 2 * 60 * 1000; // first backoff on failure
const RAW_CALENDAR_FAILURE_MAX_MS = 20 * 60 * 1000; // cap so it still self-heals within the day
let rawCalendarCache = { at: 0, result: null };
let rawCalendarConsecutiveFailures = 0;

function istDateString(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

// Free, keyless economic calendar feed — the primary source, since it has
// worked reliably in practice (unlike forexfactory.com's own site, which
// blocks requests from cloud/datacenter IPs the same way Yahoo Finance does).
function currentFailureBackoffMs() {
  // Doubles with each consecutive failure (2m, 4m, 8m, ... capped at 20m) so
  // that if the feed is genuinely rate-limiting us, we back off harder
  // instead of retrying every couple of minutes and extending the ban.
  const backoff = RAW_CALENDAR_FAILURE_BASE_MS * Math.pow(2, Math.max(0, rawCalendarConsecutiveFailures - 1));
  return Math.min(backoff, RAW_CALENDAR_FAILURE_MAX_MS);
}

async function fetchRawCalendar() {
  const now = Date.now();
  const ttl = rawCalendarCache.result && rawCalendarCache.result.available
    ? RAW_CALENDAR_CACHE_TTL_MS
    : currentFailureBackoffMs();
  if (rawCalendarCache.result && now - rawCalendarCache.at < ttl) {
    return rawCalendarCache.result;
  }

  let result;
  try {
    const res = await fetch(FF_CALENDAR_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': BROWSER_USER_AGENT }
    });
    if (!res.ok) {
      rawCalendarConsecutiveFailures++;
      const retryAfter = res.headers.get('retry-after');
      console.error(
        `Forex Factory public calendar fetch failed: http ${res.status}` +
          (retryAfter ? ` (retry-after: ${retryAfter}s)` : '') +
          ` — backing off ${Math.round(currentFailureBackoffMs() / 1000)}s (consecutive failures: ${rawCalendarConsecutiveFailures})`
      );
      result = { available: false, reason: `http ${res.status}` };
    } else {
      const events = await res.json();
      if (!Array.isArray(events)) {
        rawCalendarConsecutiveFailures++;
        result = { available: false, reason: 'unexpected response shape' };
      } else {
        rawCalendarConsecutiveFailures = 0;
        const highImpact = events
          .filter(e => e && String(e.impact).toLowerCase() === 'high')
          .map(e => ({
            title: e.title || '(untitled)',
            country: e.country || '',
            date: e.date || null,
            forecast: e.forecast || null,
            previous: e.previous || null,
            actual: e.actual || null
          }))
          .sort((a, b) => (a.date && b.date ? new Date(a.date) - new Date(b.date) : 0));
        result = { available: true, data: highImpact };
      }
    }
  } catch (err) {
    rawCalendarConsecutiveFailures++;
    console.error('Forex Factory public calendar fetch failed:', err.message);
    result = { available: false, reason: err.message };
  }

  rawCalendarCache = { at: now, result };
  return result;
}

async function getFromPublicCalendar() {
  return fetchRawCalendar();
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

// The user's OpenAI key has no billing credits as of the last check, but
// re-verify rather than assume — a quota error here is OpenAI's own answer,
// not a guess. Note: without a browsing/search tool, this can only draw on
// the model's training data, not literally today's news, so the prompt asks
// it to say so rather than invent a "latest" headline.
async function getFromOpenAI(openaiApiKey) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content:
              'What are the major recurring or scheduled macroeconomic events that typically move gold, bitcoin, and EUR/USD (e.g. Fed meetings, US CPI/NFP releases)? ' +
              "You do not have live internet access, so do not invent specific numbers or claim something happened 'today' or 'this week' — describe the kind of event and its usual market impact in 2-3 sentences."
          }
        ],
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(15000)
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Forex Factory OpenAI fetch failed:', JSON.stringify(data));
      return { available: false, reason: data.error?.message || `http ${res.status}` };
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return { available: false, reason: 'empty response' };

    return { available: true, data: [{ title: 'AI market context (not live news)', summary: text }] };
  } catch (err) {
    console.error('Forex Factory OpenAI fetch failed:', err.message);
    return { available: false, reason: err.message };
  }
}

// Uses Gemini's Google Search grounding so the answer is backed by an
// actual live search rather than the model's static training data — this
// runs from Google's own infrastructure, so it isn't affected by Render's
// IP being blocked the way forexfactory.com and Yahoo Finance block it.
async function getFromGeminiSearch(geminiApiKey) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    'Search for the most important high-impact economic news and events from the last 24-48 hours ' +
                    'likely to move gold (XAUUSD), bitcoin, or EUR/USD. List up to 5 items as short headlines with a ' +
                    'one-line summary each. If you cannot find real current results, say so explicitly instead of guessing.'
                }
              ]
            }
          ],
          tools: [{ google_search: {} }]
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    const data = await res.json();
    if (!res.ok) {
      console.error('Forex Factory Gemini-search fetch failed:', JSON.stringify(data));
      return { available: false, reason: data.error?.message || `http ${res.status}` };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { available: false, reason: 'empty response' };

    return { available: true, data: [{ title: 'AI-searched market news', summary: text }] };
  } catch (err) {
    console.error('Forex Factory Gemini-search fetch failed:', err.message);
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

  if (env && env.GEMINI_API_KEY) {
    const geminiSearch = await getFromGeminiSearch(env.GEMINI_API_KEY);
    if (geminiSearch.available) return geminiSearch;
  }

  if (env && env.OPENAI_API_KEY) {
    const openai = await getFromOpenAI(env.OPENAI_API_KEY);
    if (openai.available) return openai;
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

// Real, structured, live calendar data only — no scrape fallback (its items
// have no time/actual fields anyway) and never the AI-search/AI-text
// fallbacks used for chat reasoning. Filtered to events dated "today" in
// IST, so it naturally rolls over to the next day's calendar at midnight IST
// on its own, without needing any separate scheduled job. Reads through the
// same shared raw-calendar cache as getForexFactoryNews, so polling this
// frequently from the frontend never means an extra upstream fetch.
async function getEconomicCalendar() {
  const calendar = await fetchRawCalendar();
  if (!calendar.available) return calendar;

  const today = istDateString(new Date());
  const todaysEvents = calendar.data.filter(e => e.date && istDateString(new Date(e.date)) === today);

  return { available: true, data: todaysEvents };
}

module.exports = { getForexFactoryNews, getEconomicCalendar };
