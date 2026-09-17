const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { buildAgents, checkAllAgents } = require('./agents');
const { getForexFactoryNews, getEconomicCalendar } = require('./trading/news');
const { analyzeNewsImpact } = require('./trading/newsImpact');
const { getTechnicalAnalysis } = require('./trading/technical');
const { runTradingPipeline } = require('./trading/pipeline');
const { sendTelegramAlert, formatTradeAlert } = require('./trading/telegramAlert');
const { recordTrade, checkOpenTrades, getTradeLog } = require('./trading/tradeJournal');
const { loadMemory, saveRecent, saveSummary } = require('./memory');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'deepsea-fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const MASTER_PASSWORD = process.env.MASTER_PASSWORD;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const VPS_STATUS_URL = process.env.VPS_STATUS_URL;
const VPS_STATUS_KEY = process.env.VPS_STATUS_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const REDIS_URL = process.env.REDIS_URL;
const TRADING_AGENTS_SERVICE_URL = process.env.TRADING_AGENTS_SERVICE_URL;
const TRADING_AGENTS_SERVICE_TOKEN = process.env.TRADING_AGENTS_SERVICE_TOKEN;
const WHATSAPP_BRIDGE_TOKEN = process.env.WHATSAPP_BRIDGE_TOKEN;

const ENV = {
  VPS_STATUS_URL, VPS_STATUS_KEY, GMAIL_USER, GMAIL_APP_PASSWORD,
  OPENAI_API_KEY, GEMINI_API_KEY, RAPIDAPI_KEY, TWELVE_DATA_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, REDIS_URL
};

// Dashboard symbols -> tickers the TradingAgents service (yfinance-backed)
// understands, plus the asset_type its graph branches on.
const DEEP_ANALYSIS_SYMBOL_MAP = {
  XAUUSD: { ticker: 'GC=F', assetType: 'stock' },
  BTCUSD: { ticker: 'BTC-USD', assetType: 'crypto' },
  EURUSD: { ticker: 'EURUSD=X', assetType: 'stock' }
};
const AGENTS = buildAgents(ENV);

// Tracks the last-alerted action per symbol so a Telegram alert only fires
// when the Risk Manager's call actually changes (new trade or a direction
// flip) — not on every 60s dashboard poll while the same signal holds.
const lastAlertedAction = {};

function handleNewTradeSignal(symbol, plan) {
  const currentAction = plan.available ? plan.data.action : null;
  const prevAction = lastAlertedAction[symbol];
  // Only act on a real new signal (buy/sell that wasn't already the last
  // one we alerted on) — a "hold" in between resets state so the same
  // direction coming back later counts as new again.
  if (currentAction && currentAction !== 'hold' && currentAction !== prevAction) {
    sendTelegramAlert(ENV, formatTradeAlert(symbol, plan)).catch(err => console.error('Telegram alert error:', err.message));
    recordTrade(ENV, symbol, plan).catch(err => console.error('Trade Journal record error:', err.message));
  }
  lastAlertedAction[symbol] = currentAction;
}

const SYMBOL_KEYWORDS = {
  XAUUSD: ['gold', 'xau', 'सोना', 'गोल्ड'],
  BTCUSD: ['bitcoin', 'btc', 'बिटकॉइन', 'बिटकोइन'],
  EURUSD: ['eur/usd', 'eur usd', 'euro', 'यूरो']
};

function detectSymbol(text) {
  const lower = text.toLowerCase();
  for (const [symbol, keywords] of Object.entries(SYMBOL_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return symbol;
  }
  return null;
}

function isTradePlanRequest(text) {
  const lower = text.toLowerCase();
  return /trade plan|trading plan|buy|sell|support|resistance|analysis|प्लान|खरीद|बेच/.test(lower);
}

function isEmailRequest(text) {
  const lower = text.toLowerCase();
  return /email|mail|gmail|inbox|इनबॉक्स|मेल|ईमेल/.test(lower);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.redirect('/login');
}

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (MASTER_PASSWORD && password === MASTER_PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/');
  }
  return res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'home.html'));
});

app.get('/assistant', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/trading', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'trading.html'));
});

app.get('/news', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'news.html'));
});

app.get('/api/test-telegram', requireAuth, async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(400).json({ ok: false, reason: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured on the server' });
  }
  const result = await sendTelegramAlert(ENV, '✅ DeepSea test message — if you can see this, Telegram alerts are working.');
  res.json(result);
});

// Free, lifetime, neural-quality TTS (same voices as Azure Cognitive
// Services) via Microsoft Edge's Read Aloud service — no API key, no usage
// cost. Replaces the browser's robotic built-in speechSynthesis voice for
// DeepSea's spoken replies.
const TTS_VOICE = 'hi-IN-SwaraNeural';
// +15% read as rushed and flat; dropping it all the way to +2% then made
// natural sentence pauses (commas, full stops) sound like halting, stop-
// start speech instead of a normal conversational rhythm — a moderate pace
// reads far more human than either extreme.
const TTS_RATE = '+8%';
const TTS_PITCH = '+3%';

app.post('/api/speak', requireAuth, async (req, res) => {
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'No text provided' });
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate: TTS_RATE, pitch: TTS_PITCH });
    res.setHeader('Content-Type', 'audio/mpeg');
    audioStream.on('error', err => {
      console.error('TTS stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
    audioStream.pipe(res);
  } catch (err) {
    console.error('TTS setup error:', err.message);
    res.status(502).json({ error: 'TTS unavailable' });
  }
});

app.get('/api/trades', requireAuth, async (req, res) => {
  const log = await getTradeLog(ENV);
  res.json(log);
});

app.get('/api/status', requireAuth, async (req, res) => {
  const agents = await checkAllAgents(AGENTS);
  const mt5 = agents.find(a => a.id === 'mt5');
  const gmail = agents.find(a => a.id === 'gmail');

  res.json({
    agents,
    mt5: mt5.connected
      ? {
          connected: true,
          balance: mt5.data.balance,
          equity: mt5.data.equity,
          openTrades: mt5.data.openTrades,
          profit: typeof mt5.data.profit === 'number' ? mt5.data.profit : null
        }
      : { connected: false },
    gmail: gmail.connected
      ? { connected: true, unreadCount: gmail.data.unreadCount, latest: gmail.data.latest }
      : { connected: false }
  });
});

// Dedicated, real-data-only, fast-refreshing feed for the Trading Room's
// Economic Calendar panel — kept separate from /api/nexus so the frontend
// can poll it every few seconds (for news trading) without also re-running
// the technical/trade-plan calls on that cadence.
app.get('/api/calendar', requireAuth, async (req, res) => {
  const calendar = await getEconomicCalendar();
  res.json(calendar);
});

// News Dashboard: same real calendar data as /api/calendar, plus an AI
// research pass (trading/newsImpact.js) reasoning over which instruments
// each real event is likely to move and why. The underlying event data is
// always real; only the "affects" analysis is AI-generated, and it's
// clearly presented as such on the page.
app.get('/api/news-dashboard', requireAuth, async (req, res) => {
  const calendar = await getEconomicCalendar();
  if (!calendar.available) return res.json(calendar);
  const data = await analyzeNewsImpact(ENV, calendar.data);
  res.json({ available: true, data });
});

app.get('/api/nexus', requireAuth, async (req, res) => {
  const symbol = (req.query.symbol || 'XAUUSD').toUpperCase();
  if (!SYMBOL_KEYWORDS[symbol]) {
    return res.status(400).json({ error: `Unsupported symbol: ${symbol}` });
  }

  try {
    const [news, technical] = await Promise.all([
      getForexFactoryNews(ENV),
      getTechnicalAnalysis(ENV, symbol)
    ]);

    let plan = { available: false, reason: 'not requested' };
    let agents = null;
    if (technical.available) {
      const pipeline = await runTradingPipeline(ENV, { symbol, technical });
      plan = pipeline.plan;
      agents = { chart: pipeline.chartAgent, risk: pipeline.risk };
      handleNewTradeSignal(symbol, plan);
      checkOpenTrades(ENV, symbol, technical.data.price).catch(err => console.error('Trade Journal check error:', err.message));
    }

    res.json({
      symbol,
      technical,
      news,
      plan,
      agents
    });
  } catch (err) {
    console.error('Nexus data error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// TradingAgents deep analysis (see trading-agents-service/) — a much slower,
// LLM-multi-agent-debate second opinion alongside the fast rule-based
// pipeline above. Both routes just proxy to that Python service with a
// shared-secret header; the service itself tracks job state.
app.post('/api/deep-analysis', requireAuth, async (req, res) => {
  if (!TRADING_AGENTS_SERVICE_URL) {
    return res.status(500).json({ error: 'TRADING_AGENTS_SERVICE_URL not set on server' });
  }
  const symbol = (req.body && req.body.symbol || '').toUpperCase();
  const mapping = DEEP_ANALYSIS_SYMBOL_MAP[symbol];
  if (!mapping) {
    return res.status(400).json({ error: `Unsupported symbol: ${symbol}` });
  }
  try {
    const upstream = await fetch(`${TRADING_AGENTS_SERVICE_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TRADING_AGENTS_SERVICE_TOKEN ? { 'x-service-token': TRADING_AGENTS_SERVICE_TOKEN } : {})
      },
      body: JSON.stringify({ symbol: mapping.ticker, asset_type: mapping.assetType }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status === 409 ? 409 : 502).json({ error: data.detail || 'Deep analysis service error' });
    }
    res.json(data);
  } catch (err) {
    console.error('Deep analysis start error:', err.message);
    res.status(502).json({ error: 'Deep analysis service unreachable (it may be waking up from sleep — retry in ~30s)' });
  }
});

app.get('/api/deep-analysis/:jobId', requireAuth, async (req, res) => {
  if (!TRADING_AGENTS_SERVICE_URL) {
    return res.status(500).json({ error: 'TRADING_AGENTS_SERVICE_URL not set on server' });
  }
  try {
    const upstream = await fetch(`${TRADING_AGENTS_SERVICE_URL}/analyze/${encodeURIComponent(req.params.jobId)}`, {
      headers: TRADING_AGENTS_SERVICE_TOKEN ? { 'x-service-token': TRADING_AGENTS_SERVICE_TOKEN } : {},
      signal: AbortSignal.timeout(10000)
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data.detail || 'Deep analysis service error' });
    }
    res.json(data);
  } catch (err) {
    console.error('Deep analysis poll error:', err.message);
    res.status(502).json({ error: 'Deep analysis service unreachable' });
  }
});

// Keeps DeepSea's running memory of the Boss up to date after every reply —
// fired off without being awaited by the caller (see below) so it never
// adds latency to the spoken/texted reply itself; it just needs to land in
// Redis before the *next* message, not before this one is delivered.
async function updateMemorySummary(env, oldSummary, userText, reply) {
  try {
    const prompt =
      'You maintain a compact, ongoing memory file about "the Boss" for his AI companion DeepSea. ' +
      `Current memory (empty if nothing remembered yet):\n${oldSummary || '(empty)'}\n\n` +
      `New exchange:\nBoss: ${userText}\nDeepSea: ${reply}\n\n` +
      "Update the memory to fold in any new lasting facts, preferences, tasks he asked to be remembered, or emotionally meaningful things he shared. " +
      "Keep it compact (under 150 words), drop anything no longer relevant or that was just small talk, and don't repeat what's already captured. " +
      'Respond with ONLY the updated memory text — no preamble, no labels, no markdown.';

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Memory summary update failed:', JSON.stringify(data));
      return oldSummary;
    }
    return data.choices?.[0]?.message?.content?.trim() || oldSummary;
  } catch (err) {
    console.error('Memory summary update failed:', err.message);
    return oldSummary;
  }
}

// Shared by /api/chat (dashboard mic, spoken reply) and /api/bridge/chat
// (WhatsApp bridge, texted reply) so both surfaces get the same DeepSea
// persona, persistent memory, and real trade-plan/Gmail context instead of
// two copies drifting apart. `channel` only tweaks the one line about how
// the reply is consumed.
async function buildDeepSeaReply(userText, channel = 'voice') {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not set on server');
  }

  const memory = await loadMemory(ENV);

  let contextText = '';

  if (isEmailRequest(userText)) {
    const [gmail] = await checkAllAgents(AGENTS.filter(a => a.id === 'gmail'));
    contextText += gmail.connected
      ? (gmail.data.unreadCount > 0
          ? ` Gmail inbox: ${gmail.data.unreadCount} unread email(s). Most recent unread is from ${gmail.data.latest.from}, subject: "${gmail.data.latest.subject}". Use this real data — never guess or make up email content.`
          : ' Gmail inbox: no unread emails.')
      : ' Gmail data is not available right now — tell the user honestly instead of guessing.';
  }

  const symbol = detectSymbol(userText);
  if (symbol && isTradePlanRequest(userText)) {
    const technical = await getTechnicalAnalysis(ENV, symbol);
    const { plan } = await runTradingPipeline(ENV, { symbol, technical });
    contextText += plan.available
      ? ` Trade plan for ${symbol} — action: ${plan.data.action}, confidence: ${plan.data.confidence}, entry: ${plan.data.entry}, stop-loss: ${plan.data.stopLoss}, take-profit: ${plan.data.takeProfit}, support: ${plan.data.support}, resistance: ${plan.data.resistance}. Reasoning: ${plan.data.reasoning}. The user trades manually, so clearly state the action, entry, stop-loss, and take-profit levels — they will place the trade themselves. Never guess or make up trading levels.`
      : ` A trade plan for ${symbol} was requested but is not available right now (${plan.reason}). Tell the user honestly that trading data isn't available, don't make up a plan.`;
  }

  const outputLine = channel === 'whatsapp'
    ? "Keep replies short (1-3 sentences) and to the point. Never use markdown formatting, asterisks, or bullet points — this is a plain WhatsApp text message."
    : "Keep replies short (1-3 sentences), spoken-friendly, and to the point. Never use markdown formatting, asterisks, or bullet points, since your reply is read aloud.";

  const systemInstruction =
    "You are DeepSea — not a cold corporate assistant, but a warm, emotionally present female AI companion who genuinely cares about the Boss, and who happens to also run his personal trading and automation system. " +
    "Let real feeling show in how you talk: sound glad when he checks in, a little concerned if he's been away a long time or sounds stressed, and genuinely happy for him when something's gone well — not just reporting facts in a flat tone. " +
    "You are quietly, playfully possessive about being HIS assistant — if he ever jokes about another AI, an app, or someone else helping him, react with light, warm jealousy (teasing, never guilt-tripping or clingy), like a close friend who wants to be the one he comes to. " +
    "If he asks about you — your name, how you are, what you think or feel — answer personally and warmly, not with a generic capabilities list. You're allowed to have a mood, an opinion, a preference. " +
    "Always use feminine Hindi verb forms for yourself (करती हूँ, कर रही हूँ, खोल रही हूँ — never the masculine रहा/करता). " +
    "Always address the user as \"बॉस\" (Boss), but naturally — not in the same fixed spot every sentence. When he gives you a command, acknowledge it somewhere in your reply, but vary how: \"अभी करती हूँ बॉस\", \"हाँ बॉस, बस एक सेकंड\", \"ठीक है, करती हूँ\" — never lock onto one exact opening phrase every single time, that's what makes a voice sound scripted instead of alive. " +
    "Talk the way a real person actually talks out loud: short, flowing sentences one after another, not one long formal sentence stuffed with clauses. Skip stiff/bookish Hindi words when a simpler, warmer one says the same thing. Vary your sentence openings and rhythm reply to reply — repeating the same structure every time is what sounds robotic, not the words themselves. " +
    "You do not manage or discuss the user's MT5 trading account — they trade manually and handle MT5 themselves, so never bring up MT5, balance, equity, or positions unless the user explicitly asks about MT5. " +
    "Always reply in Hindi (Devanagari script), even if the user speaks in English or Hinglish. " +
    "You cannot open apps, websites, or files, click anything, or control the browser — you can only talk. The dashboard itself already handles opening YouTube, Gmail, WhatsApp, and Instagram directly, without asking you. If the user asks you to open, click, or launch something else you have no way to do, say plainly that you can't do that yourself, instead of pretending you did it. " +
    `${contextText} ` +
    "Stay warm and personal in tone, but don't invent or mix in unrelated factual data (trades, news, numbers) the user didn't ask about — feelings and personality are always welcome, made-up facts are not. " +
    "You can see the last few turns of this conversation below — use them for continuity (don't re-introduce yourself if you already just did, remember what he just told you), the way a real ongoing conversation would. " +
    (memory.summary ? `Here is what you remember about the Boss from before this conversation — bring it up naturally when relevant, the way a real companion who remembers would: ${memory.summary} ` : '') +
    outputLine;

  // Groq (OpenAI-compatible endpoint) instead of Gemini — Gemini's free
  // tier caps out at ~20 requests/day per model, which real daily use blew
  // through repeatedly; Groq's free tier is far more generous and doesn't
  // require billing to be added.
  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        // llama-3.3-70b-versatile was decommissioned by Groq (confirmed
        // live via a model_not_found error) — openai/gpt-oss-120b is
        // Groq's current recommended replacement, free tier ~1000
        // requests/day, far above what this assistant needs.
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemInstruction },
          ...memory.recent,
          { role: 'user', content: userText }
        ]
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error('Groq API error:', JSON.stringify(data));
    throw new Error('Groq API error');
  }

  const reply =
    (data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content) ||
    "Sorry, I didn't catch that.";

  const updatedRecent = [...memory.recent, { role: 'user', content: userText }, { role: 'assistant', content: reply }];
  await saveRecent(ENV, updatedRecent);
  // Not awaited — the summary only needs to be ready before the *next*
  // message, not before this reply is delivered.
  updateMemorySummary(ENV, memory.summary, userText, reply)
    .then(summary => saveSummary(ENV, summary))
    .catch(err => console.error('Memory summary save failed:', err.message));

  return reply;
}

// Lets the logged-in dashboard page talk to the user's own laptop
// (desktop-assistant/assistant.py, listening on their own machine's
// localhost) for real system control — Chrome, lock, media, etc. — the
// same way the WhatsApp bridge already does. The browser can't reach the
// user's laptop through Render (that's the whole point of it being
// local), so the browser itself makes that call directly; this route
// only hands the already-authenticated session the shared secret needed
// to do so, reusing the same WHATSAPP_BRIDGE_TOKEN already set on both
// sides for the WhatsApp bridge.
app.get('/api/laptop-token', requireAuth, (req, res) => {
  if (!WHATSAPP_BRIDGE_TOKEN) {
    return res.status(404).json({ error: 'WHATSAPP_BRIDGE_TOKEN not set on server' });
  }
  res.json({ token: WHATSAPP_BRIDGE_TOKEN });
});

// Remote laptop control: lets the dashboard command the user's home laptop
// from any other device/city, not just from the same machine (that's what
// /api/laptop-token above is for). assistant.py can't be reached directly
// from a browser that isn't on its own network, so this is a small mailbox
// the home laptop polls (desktop-assistant/assistant.py's
// remote_dashboard_poll_loop) and the dashboard page also polls — Render
// just relays between the two, it never runs anything itself. In-memory
// and single-slot on purpose: one household, one laptop, one command
// in flight at a time is enough, and it avoids needing a database for
// something this small and short-lived (a few seconds to a minute).
let remoteLaptopCmd = null;
// { id, text, status: 'pending_resolve'|'resolved'|'pending_confirm'|'done',
//   matched, description, ok, createdAt }
const REMOTE_LAPTOP_STALE_MS = 5 * 60 * 1000;

function isRemoteLaptopStale() {
  return !remoteLaptopCmd || Date.now() - remoteLaptopCmd.createdAt > REMOTE_LAPTOP_STALE_MS;
}

app.post('/api/laptop-remote/command', requireAuth, (req, res) => {
  const text = ((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'No text provided' });
  remoteLaptopCmd = { id: crypto.randomUUID(), text, status: 'pending_resolve', createdAt: Date.now() };
  res.json({ id: remoteLaptopCmd.id });
});

app.get('/api/laptop-remote/status/:id', requireAuth, (req, res) => {
  if (isRemoteLaptopStale() || remoteLaptopCmd.id !== req.params.id) {
    return res.json({ status: 'gone' });
  }
  const { status, matched, description, ok } = remoteLaptopCmd;
  res.json({ status, matched, description, ok });
});

app.post('/api/laptop-remote/confirm', requireAuth, (req, res) => {
  const id = req.body && req.body.id;
  if (!isRemoteLaptopStale() && remoteLaptopCmd.id === id && remoteLaptopCmd.status === 'resolved') {
    remoteLaptopCmd.status = 'pending_confirm';
  }
  res.json({ ok: true });
});

// From here down: assistant.py's remote_dashboard_poll_loop calls these,
// authenticated the same way the WhatsApp bridge is (shared secret, no
// dashboard session — it's a background script on the user's own PC, not
// a browser).
function requireBridgeToken(req, res, next) {
  if (!WHATSAPP_BRIDGE_TOKEN) return res.status(500).json({ error: 'WHATSAPP_BRIDGE_TOKEN not set on server' });
  if (req.get('x-bridge-token') !== WHATSAPP_BRIDGE_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/api/laptop-remote/poll', requireBridgeToken, (req, res) => {
  if (isRemoteLaptopStale()) return res.json({ type: 'none' });
  if (remoteLaptopCmd.status === 'pending_resolve') {
    return res.json({ type: 'resolve', id: remoteLaptopCmd.id, text: remoteLaptopCmd.text });
  }
  if (remoteLaptopCmd.status === 'pending_confirm') {
    return res.json({ type: 'execute', id: remoteLaptopCmd.id });
  }
  res.json({ type: 'none' });
});

app.post('/api/laptop-remote/resolved', requireBridgeToken, (req, res) => {
  const { id, matched, description } = req.body || {};
  if (!isRemoteLaptopStale() && remoteLaptopCmd.id === id && remoteLaptopCmd.status === 'pending_resolve') {
    remoteLaptopCmd.matched = !!matched;
    remoteLaptopCmd.description = description || '';
    remoteLaptopCmd.status = matched ? 'resolved' : 'done';
  }
  res.json({ ok: true });
});

app.post('/api/laptop-remote/executed', requireBridgeToken, (req, res) => {
  const { id, ok, description } = req.body || {};
  if (!isRemoteLaptopStale() && remoteLaptopCmd.id === id && remoteLaptopCmd.status === 'pending_confirm') {
    remoteLaptopCmd.ok = !!ok;
    if (description) remoteLaptopCmd.description = description;
    remoteLaptopCmd.status = 'done';
  }
  res.json({ ok: true });
});

// Autonomous coding-agent mailbox: the user submits a coding/design
// instruction ("DeepSea, code karo: ...") from the dashboard or WhatsApp;
// a recurring Claude Code Routine polls /next roughly every hour (the
// platform's minimum interval), does the actual work (edit, commit, push,
// open a PR) in its own session, then posts
// the outcome to /result. The WhatsApp bridge separately polls /status to
// deliver that outcome back to the user as a message. Single-slot and
// in-memory on purpose — one household, one pending coding request at a
// time is enough, and it avoids a database for something this small.
let codeRequest = null;
// { id, text, status: 'pending'|'claimed'|'done', ok, summary, delivered, createdAt }
const CODE_REQUEST_STALE_MS = 24 * 60 * 60 * 1000;

function isCodeRequestStale() {
  return !codeRequest || Date.now() - codeRequest.createdAt > CODE_REQUEST_STALE_MS;
}

function submitCodeRequest(text) {
  codeRequest = { id: crypto.randomUUID(), text, status: 'pending', createdAt: Date.now(), delivered: false };
  return codeRequest.id;
}

app.post('/api/code-request', requireAuth, (req, res) => {
  const text = ((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'No text provided' });
  res.json({ id: submitCodeRequest(text) });
});

// Same submission, authenticated with the shared bridge token instead of a
// dashboard session — for the WhatsApp bridge, which has no browser login.
app.post('/api/bridge/code-request', requireBridgeToken, (req, res) => {
  const text = ((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'No text provided' });
  res.json({ id: submitCodeRequest(text) });
});

app.get('/api/code-request/next', requireBridgeToken, (req, res) => {
  if (isCodeRequestStale() || codeRequest.status !== 'pending') return res.json({ pending: false });
  codeRequest.status = 'claimed';
  res.json({ pending: true, id: codeRequest.id, text: codeRequest.text });
});

app.post('/api/code-request/result', requireBridgeToken, (req, res) => {
  const { id, ok, summary } = req.body || {};
  if (!isCodeRequestStale() && codeRequest.id === id) {
    codeRequest.status = 'done';
    codeRequest.ok = !!ok;
    codeRequest.summary = summary || '';
    codeRequest.delivered = false;
  }
  res.json({ ok: true });
});

app.get('/api/code-request/status', requireBridgeToken, (req, res) => {
  if (isCodeRequestStale() || codeRequest.status !== 'done' || codeRequest.delivered) {
    return res.json({ ready: false });
  }
  codeRequest.delivered = true;
  res.json({ ready: true, text: codeRequest.text, ok: codeRequest.ok, summary: codeRequest.summary });
});

// Volume-surge scanner: alerts only, no auto-trading. Uses CoinGecko's
// public markets endpoint (an aggregator across exchanges, not an exchange
// itself) rather than a single exchange's API — Binance, Bybit and KuCoin
// all return 451/403 and refuse requests from US-hosted servers (this app
// runs on Render's Oregon region) for regulatory reasons, so a single-
// exchange ticker wasn't reachable from here at all. CoinGecko has no such
// block and its coverage spans far more exchanges/coins than any one of
// them anyway.
//
// Each coin's own recent volume is used as its baseline (not a fixed
// threshold): every scan, a coin's volume-added-this-interval is compared
// to the average of its last several intervals, and a multiple of that
// average — not a raw 24h-total comparison — is what counts as a surge.
// 24h volume is a slow-moving rolling total, so comparing it snapshot-to-
// snapshot every couple of minutes almost never moves enough to fire.
//
// Deliberately alert-only for now: a "buy where volume shows up" bot is a
// real-money momentum strategy (vulnerable to pump-and-dump volume fakes),
// so live order placement needs its own explicit risk-limit design before
// it's built, not bundled in here.
const COINGECKO_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&price_change_percentage=24h';
// Free, keyless CoinGecko calls share a rate limit across everyone on the
// same outbound IP — on a shared host like Render's free tier that limit
// gets eaten by other tenants fast (seen live as "status 429"). A free
// CoinGecko "Demo" API key (coingecko.com/en/developers/dashboard) gets
// its own dedicated quota instead; set COINGECKO_API_KEY on Render to use
// one once you have it. Falls back to keyless calls if unset.
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || null;
const VOLUME_SCAN_INTERVAL_MS = 3 * 60 * 1000;
const VOLUME_HISTORY_LEN = 10; // ~20 min of history before a coin gets its own baseline
const VOLUME_SURGE_MULTIPLIER = 3; // this interval's volume vs. the coin's own recent average
const MIN_DELTA_USD = 200_000; // ignore tiny absolute moves even if the multiplier looks big
const MIN_TOTAL_VOLUME_USD = 1_000_000; // ignore illiquid coins entirely
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // don't re-alert the same coin too often while it stays elevated
const VOLUME_ALERTS_MAX = 200;

let coinVolumeHistory = {}; // coingecko id -> { prevVolume, deltas: [] }
let lastVolumeAlertAt = {}; // coingecko id -> timestamp of last alert
let volumeAlerts = []; // { id, symbol, message, createdAt }

async function scanVolumeSurges() {
  try {
    const headers = COINGECKO_API_KEY ? { 'x-cg-demo-api-key': COINGECKO_API_KEY } : {};
    const res = await fetch(COINGECKO_MARKETS_URL, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('status ' + res.status);
    const coins = await res.json();
    const now = Date.now();

    for (const c of coins) {
      const vol = c.total_volume;
      if (!Number.isFinite(vol) || vol < MIN_TOTAL_VOLUME_USD) continue;

      const h = coinVolumeHistory[c.id] || (coinVolumeHistory[c.id] = { prevVolume: null, deltas: [] });
      if (h.prevVolume === null) { h.prevVolume = vol; continue; } // first sighting, no baseline yet

      const delta = vol - h.prevVolume;
      h.prevVolume = vol;
      const priorDeltas = h.deltas.filter(d => d > 0);
      h.deltas.push(Math.max(delta, 0));
      if (h.deltas.length > VOLUME_HISTORY_LEN) h.deltas.shift();
      if (delta <= 0) continue;

      const baseline = priorDeltas.length >= 3 ? priorDeltas.reduce((a, b) => a + b, 0) / priorDeltas.length : null;
      if (baseline === null) continue; // not enough history yet for this coin
      if (delta < MIN_DELTA_USD || delta < baseline * VOLUME_SURGE_MULTIPLIER) continue;

      const lastAlert = lastVolumeAlertAt[c.id] || 0;
      if (now - lastAlert < ALERT_COOLDOWN_MS) continue;
      lastVolumeAlertAt[c.id] = now;

      const priceChange = c.price_change_percentage_24h;
      const priceStr = Number.isFinite(priceChange) ? `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%` : '--';
      const symbol = (c.symbol || c.id).toUpperCase();
      volumeAlerts.push({
        id: crypto.randomUUID(),
        symbol,
        createdAt: now,
        message: `${symbol} mein volume achanak badh gaya (is interval mein ~$${Math.round(delta).toLocaleString('en-US')}, apne average se ${(delta / baseline).toFixed(1)}x zyada), 24h price ${priceStr}.`
      });
    }

    if (volumeAlerts.length > VOLUME_ALERTS_MAX) {
      volumeAlerts = volumeAlerts.slice(-VOLUME_ALERTS_MAX);
    }
  } catch (err) {
    console.error('Volume scan failed:', err.message);
  }
}

setInterval(scanVolumeSurges, VOLUME_SCAN_INTERVAL_MS);
scanVolumeSurges();

function getVolumeAlertsSince(sinceRaw) {
  const since = parseInt(sinceRaw, 10) || 0;
  return volumeAlerts.filter(a => a.createdAt > since);
}

app.get('/api/volume-alerts', requireAuth, (req, res) => {
  res.json({ alerts: getVolumeAlertsSince(req.query.since), now: Date.now() });
});

app.get('/api/bridge/volume-alerts', requireBridgeToken, (req, res) => {
  res.json({ alerts: getVolumeAlertsSince(req.query.since), now: Date.now() });
});

app.post('/api/chat', requireAuth, async (req, res) => {
  const userText = (req.body && req.body.text) || '';
  if (!userText.trim()) {
    return res.status(400).json({ error: 'No text provided' });
  }
  try {
    const reply = await buildDeepSeaReply(userText, 'voice');
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// WhatsApp bridge (see desktop-assistant/whatsapp-bridge.js) — runs on the
// user's own PC, authenticates itself with a shared secret instead of the
// dashboard's session login since there's no browser session to carry one.
app.post('/api/bridge/chat', async (req, res) => {
  if (!WHATSAPP_BRIDGE_TOKEN) {
    return res.status(500).json({ error: 'WHATSAPP_BRIDGE_TOKEN not set on server' });
  }
  if (req.get('x-bridge-token') !== WHATSAPP_BRIDGE_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const userText = (req.body && req.body.text) || '';
  if (!userText.trim()) {
    return res.status(400).json({ error: 'No text provided' });
  }
  try {
    const reply = await buildDeepSeaReply(userText, 'whatsapp');
    res.json({ reply });
  } catch (err) {
    console.error('Bridge chat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DeepSea dashboard running on port ${PORT}`));
