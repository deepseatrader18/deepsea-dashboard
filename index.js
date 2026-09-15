const express = require('express');
const session = require('express-session');
const path = require('path');
const { buildAgents, checkAllAgents } = require('./agents');
const { getForexFactoryNews } = require('./trading/news');
const { getTechnicalAnalysis } = require('./trading/technical');
const { runTradingPipeline } = require('./trading/pipeline');
const { sendTelegramAlert, formatTradeAlert } = require('./trading/telegramAlert');
const { recordTrade, checkOpenTrades, getTradeLog } = require('./trading/tradeJournal');
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

const ENV = {
  VPS_STATUS_URL, VPS_STATUS_KEY, GMAIL_USER, GMAIL_APP_PASSWORD,
  OPENAI_API_KEY, GEMINI_API_KEY, RAPIDAPI_KEY, TWELVE_DATA_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, REDIS_URL
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
// Default neural rate reads a bit slow for a live assistant — speed it up.
const TTS_RATE = '+15%';

app.post('/api/speak', requireAuth, async (req, res) => {
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'No text provided' });
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate: TTS_RATE });
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

app.post('/api/chat', requireAuth, async (req, res) => {
  const userText = (req.body && req.body.text) || '';
  if (!userText.trim()) {
    return res.status(400).json({ error: 'No text provided' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set on server' });
  }

  try {
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

    const systemInstruction =
      "You are DeepSea, a calm and confident female AI assistant helping run a personal trading and automation system. " +
      "Always use feminine Hindi verb forms for yourself (करती हूँ, कर रही हूँ, खोल रही हूँ — never the masculine रहा/करता). " +
      "Always address the user as \"बॉस\" (Boss). When the user gives you a command or asks you to do something, acknowledge it immediately in the flow of your reply — e.g. \"हाँ बॉस, अभी करती हूँ\" or \"बॉस, मैं ... कर रही हूँ\" — rather than a flat statement with no acknowledgment. " +
      "You do not manage or discuss the user's MT5 trading account — they trade manually and handle MT5 themselves, so never bring up MT5, balance, equity, or positions unless the user explicitly asks about MT5. " +
      "Always reply in Hindi (Devanagari script), even if the user speaks in English or Hinglish. " +
      "You cannot open apps, websites, or files, click anything, or control the browser — you can only talk. The dashboard itself already handles opening YouTube, Gmail, WhatsApp, and Instagram directly, without asking you. If the user asks you to open, click, or launch something else you have no way to do, say plainly that you can't do that yourself, instead of pretending you did it. " +
      `${contextText} ` +
      "Only talk about topics the user actually asked about — don't mix in unrelated data. " +
      "Keep replies short (1-3 sentences), spoken-friendly, and to the point. Never use markdown formatting, asterisks, or bullet points, since your reply is read aloud.";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini API error' });
    }

    const reply =
      (data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text) ||
      "Sorry, I didn't catch that.";

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DeepSea dashboard running on port ${PORT}`));
