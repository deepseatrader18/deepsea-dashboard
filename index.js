const express = require('express');
const session = require('express-session');
const path = require('path');
const { buildAgents, checkAllAgents } = require('./agents');
const { getForexFactoryNews, getEconomicCalendar } = require('./trading/news');
const { getTechnicalAnalysis } = require('./trading/technical');
const { buildTradePlan } = require('./trading/tradePlan');
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
const TECHNICAL_SERVICE_URL = process.env.TECHNICAL_SERVICE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

const ENV = { VPS_STATUS_URL, VPS_STATUS_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, TECHNICAL_SERVICE_URL, OPENAI_API_KEY, GEMINI_API_KEY, RAPIDAPI_KEY };
const AGENTS = buildAgents(ENV);

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
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/trading', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'trading.html'));
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
    if (technical.available) {
      plan = await buildTradePlan(ENV, { symbol, news, technical });
    }

    res.json({
      symbol,
      technical,
      news,
      plan
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
      const [news, technical] = await Promise.all([
        getForexFactoryNews(ENV),
        getTechnicalAnalysis(ENV, symbol)
      ]);
      const plan = await buildTradePlan(ENV, { symbol, news, technical });
      contextText += plan.available
        ? ` Trade plan for ${symbol} — action: ${plan.data.action}, confidence: ${plan.data.confidence}, entry: ${plan.data.entry}, stop-loss: ${plan.data.stopLoss}, take-profit: ${plan.data.takeProfit}, support: ${plan.data.support}, resistance: ${plan.data.resistance}. Reasoning: ${plan.data.reasoning}. The user trades manually, so clearly state the action, entry, stop-loss, and take-profit levels — they will place the trade themselves. Never guess or make up trading levels.`
        : ` A trade plan for ${symbol} was requested but is not available right now (${plan.reason}). Tell the user honestly that trading data isn't available, don't make up a plan.`;
    }

    const systemInstruction =
      "You are DeepSea, a calm and confident AI assistant helping run a personal trading and automation system. " +
      "You do not manage or discuss the user's MT5 trading account — they trade manually and handle MT5 themselves, so never bring up MT5, balance, equity, or positions unless the user explicitly asks about MT5. " +
      "Always reply in Hindi (Devanagari script), even if the user speaks in English or Hinglish. " +
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
