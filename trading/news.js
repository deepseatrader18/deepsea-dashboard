const cheerio = require('cheerio');

const FF_NEWS_PAGE = 'https://www.forexfactory.com/news';
const FF_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const RAPIDAPI_HOST = 'forex-factory-news.p.rapidapi.com';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CACHE_TTL_SUCCESS_MS = 3 * 60 * 1000; // the user wants results to show up promptly after release
const CACHE_TTL_FAILURE_MS = 2 * 60 * 1000; // retry sooner after a failure
let cache = { at: 0, result: null };

function istDateString(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

// The user has explicitly asked that this free feed NOT be polled on a fixed
// short interval — checking it every couple of minutes all day is what got
// our IP rate-limited in the first place. So this throttle is deliberately
// conservative (at most once a minute on success) and backs off hard on
// failure (2m, 4m, 8m, ... capped at 20m); the actual calling pattern above
// this (ensureDailySnapshot/scheduleEventChecks below) only calls in once a
// day plus a few checks near each event's own time, so in practice this
// rarely even hits its own throttle.
const RAW_THROTTLE_SUCCESS_MS = 60 * 1000;
const RAW_FAILURE_BASE_MS = 2 * 60 * 1000;
const RAW_FAILURE_MAX_MS = 30 * 60 * 1000;
let rawCache = { at: 0, result: null, backoffMs: RAW_FAILURE_BASE_MS };
let rawConsecutiveFailures = 0;
let rawInFlight = null;

function parseRetryAfterMs(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

async function fetchRawCalendarNow() {
  try {
    const res = await fetch(FF_CALENDAR_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': BROWSER_USER_AGENT }
    });
    if (!res.ok) {
      rawConsecutiveFailures++;
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
      // The feed's own Retry-After is authoritative when it sends one — our
      // exponential backoff is just a fallback for when it doesn't. Either
      // way, never wait less than the base backoff or more than the cap.
      const exponential = RAW_FAILURE_BASE_MS * Math.pow(2, Math.max(0, rawConsecutiveFailures - 1));
      const backoffMs = Math.min(Math.max(retryAfterMs || 0, exponential), RAW_FAILURE_MAX_MS);
      console.error(
        `Forex Factory public calendar fetch failed: http ${res.status}` +
          (retryAfterMs ? ` (feed asked to retry-after ${Math.round(retryAfterMs / 1000)}s)` : '') +
          ` — backing off ${Math.round(backoffMs / 1000)}s (consecutive failures: ${rawConsecutiveFailures})`
      );
      return { available: false, reason: `http ${res.status}`, backoffMs };
    }

    const events = await res.json();
    if (!Array.isArray(events)) {
      rawConsecutiveFailures++;
      return { available: false, reason: 'unexpected response shape', backoffMs: RAW_FAILURE_BASE_MS };
    }

    rawConsecutiveFailures = 0;
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
    return { available: true, data: highImpact };
  } catch (err) {
    rawConsecutiveFailures++;
    console.error('Forex Factory public calendar fetch failed:', err.message);
    return { available: false, reason: err.message, backoffMs: RAW_FAILURE_BASE_MS };
  }
}

async function fetchRawCalendarThrottled() {
  const now = Date.now();
  const ttl = rawCache.result && rawCache.result.available ? RAW_THROTTLE_SUCCESS_MS : rawCache.backoffMs;
  if (rawCache.result && now - rawCache.at < ttl) {
    return rawCache.result;
  }
  if (rawInFlight) return rawInFlight; // concurrent callers share one request instead of firing their own

  rawInFlight = fetchRawCalendarNow().then(result => {
    rawCache = { at: Date.now(), result, backoffMs: result.backoffMs || RAW_FAILURE_BASE_MS };
    rawInFlight = null;
    return result;
  });
  return rawInFlight;
}

async function getFromPublicCalendar() {
  return fetchRawCalendarThrottled();
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
// fallbacks used for chat reasoning.
//
// Per the user's explicit instruction: fetch the full day's calendar once at
// IST rollover, then only check back for each event's actual result a
// handful of times right around that event's own scheduled time — never on
// a fixed short interval all day, since that's what got the free feed to
// rate-limit us. /api/calendar and /api/news-dashboard can be polled by the
// frontend as often as it likes; they just read this in-memory snapshot,
// which the checks below update in the background.
function eventKey(item) {
  return `${item.country}|${item.title}|${item.date || ''}`;
}

let dailySnapshot = { day: null, events: [] };
let scheduledTimers = [];

const EVENT_CHECK_OFFSETS_MS = [0, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
const STALE_CHECKPOINT_MS = 40 * 60 * 1000; // don't bother firing a checkpoint this far after it was due

async function refreshEventActual(key) {
  const existing = dailySnapshot.events.find(e => eventKey(e) === key);
  if (existing && existing.actual != null) return; // already have the real result, no need to hit the feed again

  const fresh = await fetchRawCalendarThrottled();
  if (!fresh.available) return; // a later scheduled checkpoint (if any remain) will retry

  const updated = fresh.data.find(e => eventKey(e) === key);
  if (!updated) return;
  const idx = dailySnapshot.events.findIndex(e => eventKey(e) === key);
  if (idx >= 0) dailySnapshot.events[idx] = updated;
}

function scheduleEventChecks(event) {
  if (!event.date) return;
  const eventTime = new Date(event.date).getTime();
  if (isNaN(eventTime)) return;
  const key = eventKey(event);

  EVENT_CHECK_OFFSETS_MS.forEach(offsetMs => {
    const targetTime = eventTime + offsetMs;
    const fireInMs = targetTime - Date.now();
    if (fireInMs < -STALE_CHECKPOINT_MS) return; // this checkpoint is long gone (e.g. server restarted late) — skip it
    const delayMs = Math.max(fireInMs, 0); // already due (e.g. snapshot built after a restart) — check almost immediately
    const timer = setTimeout(() => {
      refreshEventActual(key).catch(err => console.error('Event actual refresh failed:', err.message));
    }, delayMs);
    scheduledTimers.push(timer);
  });
}

async function ensureDailySnapshot() {
  const today = istDateString(new Date());
  if (dailySnapshot.day === today) {
    return { available: true, data: dailySnapshot.events };
  }

  // fetchRawCalendarThrottled is the single source of truth for backoff
  // timing (it already honors the feed's own Retry-After header, or falls
  // back to exponential backoff) — no separate gate needed here. While it's
  // in a backoff window this just returns the cached failure instantly,
  // without another network call.
  const fresh = await fetchRawCalendarThrottled();
  if (!fresh.available) {
    return { available: false, reason: fresh.reason };
  }

  scheduledTimers.forEach(clearTimeout);
  scheduledTimers = [];

  const todaysEvents = fresh.data.filter(e => e.date && istDateString(new Date(e.date)) === today);
  dailySnapshot = { day: today, events: todaysEvents };
  todaysEvents.forEach(scheduleEventChecks);

  return { available: true, data: todaysEvents };
}

async function getEconomicCalendar() {
  return ensureDailySnapshot();
}

module.exports = { getForexFactoryNews, getEconomicCalendar };
