require('dotenv').config();

// Same conservative-by-default philosophy as crypto-agents/config.js —
// small per-trade risk, low leverage, fixed 1:3 risk:reward, tight daily
// loss cap. Every value is overridable via .env.
function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  OANDA_API_TOKEN: process.env.OANDA_API_TOKEN || '',
  OANDA_ACCOUNT_ID: process.env.OANDA_ACCOUNT_ID || '',
  // 'practice' = OANDA's free demo environment (fake money, real live gold
  // prices) — safe default, used both for reading prices and, once
  // LIVE_TRADING_ENABLED is also true, for where any real order lands.
  // Only switch to 'live' once you've funded a real OANDA account.
  OANDA_ENVIRONMENT: process.env.OANDA_ENVIRONMENT || 'practice',

  // Every pair this team scans and can trade — defaults to the major FX
  // pairs (most liquid, tightest spreads) plus gold. Comma-separated, so
  // add/remove pairs via .env without touching code — e.g. exotics like
  // USD_TRY or USD_ZAR have wider spreads and are left out by default on
  // purpose. Full OANDA instrument list: https://developer.oanda.com
  INSTRUMENTS: (process.env.INSTRUMENTS || 'EUR_USD,GBP_USD,USD_JPY,AUD_USD,USD_CAD,USD_CHF,NZD_USD,EUR_GBP,EUR_JPY,GBP_JPY,XAU_USD')
    .split(',').map(s => s.trim()).filter(Boolean),

  // Master switch — identical role to crypto-agents' one. Even with a
  // practice/live OANDA token configured, no order is ever placed unless
  // this is exactly "true". Anything else runs the full team pipeline and
  // logs what it *would* have done (paper trading) instead.
  LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED === 'true',

  // Defaulted to 100,000 — OANDA's own free practice accounts are funded
  // with roughly this much virtual money by default, and gold trades in
  // whole-ounce units worth thousands of dollars each, so a small
  // crypto-sized balance can't safely size even one unit at conservative
  // leverage. Set this to whatever you actually plan to trade with once
  // live, so paper results mean something for that real capital size.
  PAPER_STARTING_BALANCE: num('PAPER_STARTING_BALANCE', 100_000),

  // --- Risk policy ---
  PER_TRADE_RISK_PCT: num('PER_TRADE_RISK_PCT', 1), // % of free balance committed as margin per trade
  // Kept low on purpose, same reasoning as crypto's FUTURES_LEVERAGE — low
  // leverage means the account's own stop-loss always fires long before
  // any margin-call risk becomes real.
  FOREX_LEVERAGE: num('FOREX_LEVERAGE', 5),
  // Risk:reward fixed at 1:3 — target is exactly 3x the stop distance.
  STOP_LOSS_PCT: num('STOP_LOSS_PCT', 0.3),
  TAKE_PROFIT_PCT: num('TAKE_PROFIT_PCT', 0.9),
  // Minimum average confidence (0-100) the two researchers must show
  // together before an entry is taken — fewer, higher-conviction trades.
  MIN_BULL_CONFIDENCE: num('MIN_BULL_CONFIDENCE', 40),
  // 0 (or any non-positive value) means no cap — trade every pair that
  // clears the team's bar, however many that is at once. Capital still
  // self-limits this in practice (see MAX_TOTAL_EXPOSURE_PCT below), same
  // philosophy as the crypto team's MAX_CONCURRENT_TRADES.
  MAX_CONCURRENT_TRADES: num('MAX_CONCURRENT_TRADES', 0),
  // Hard ceiling on total margin committed across ALL open positions at
  // once, as a % of the day's starting balance — the real safety net when
  // MAX_CONCURRENT_TRADES is uncapped and several pairs signal at once.
  MAX_TOTAL_EXPOSURE_PCT: num('MAX_TOTAL_EXPOSURE_PCT', 25),
  DAILY_LOSS_CAP_PCT: num('DAILY_LOSS_CAP_PCT', 3), // halts new entries for the day once hit
  TRADE_COOLDOWN_MIN: num('TRADE_COOLDOWN_MIN', 15), // don't re-enter the same pair right after a close

  // --- Candles / signal timing ---
  // 5-minute candles, same timeframe as the crypto team.
  CANDLE_GRANULARITY: process.env.CANDLE_GRANULARITY || 'M5',
  CANDLE_COUNT: num('CANDLE_COUNT', 250), // enough history for the EMA50/EMA200 trend filter
  // How often to poll OANDA for a new candle / open-position status. Gold
  // is always liquid but isn't a "volume surge" market like crypto's WS
  // scanner watches for — a periodic poll is the right speed here, not a
  // live stream.
  POLL_INTERVAL_MS: num('POLL_INTERVAL_MS', 15_000),

  // --- Telegram trade alerts (same bot/chat as crypto-agents, or a
  //     separate one — either works, this just needs its own copy of the
  //     values since this runs as an independent process) ---
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  STATE_FILE: process.env.STATE_FILE || require('path').join(__dirname, 'data', 'state.json')
};

module.exports = config;
