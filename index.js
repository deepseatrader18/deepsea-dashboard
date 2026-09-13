const express = require('express');
const session = require('express-session');
const path = require('path');
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

async function getMT5Status() {
  if (!VPS_STATUS_URL || !VPS_STATUS_KEY) return null;
  try {
    const res = await fetch(`${VPS_STATUS_URL}?key=${VPS_STATUS_KEY}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('MT5 status fetch failed:', err.message);
    return null;
  }
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

app.post('/api/chat', requireAuth, async (req, res) => {
  const userText = (req.body && req.body.text) || '';
  if (!userText.trim()) {
    return res.status(400).json({ error: 'No text provided' });
  }
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set on server' });
  }

  try {
    const mt5Status = await getMT5Status();
    const statusText = mt5Status
      ? `Current live MT5 account data — Balance: ${mt5Status.balance}, Equity: ${mt5Status.equity}, Open Trades: ${mt5Status.openTrades}.`
      : 'Live MT5 account data is not available right now.';

    const systemInstruction =
      "You are DeepSea, a calm and confident AI assistant helping run a personal trading and automation system. " +
      "Always reply in Hindi (Devanagari script), even if the user speaks in English or Hinglish. " +
      `${statusText} Use this real data to answer questions about balance, equity, or open trades accurately — never guess or make up numbers. ` +
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
