require('dotenv').config();

// Same conservative-by-default philosophy as crypto-agents/ and
// forex-agents/ — small per-trade risk, low leverage-equivalent
// (multiplier), fixed 1:3 risk:reward, tight daily loss cap.
//
// IMPORTANT — read this before going live: Deriv does not accept Indian
// residents trading real forex/gold under RBI/FEMA rules the same way any
// broker would; using Deriv from India for non-INR pairs carries real
// legal risk under FEMA. That decision was made explicitly by the account
// owner after being told this — this code does not make that choice for
// you, it only implements it.
function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  // 1089 is Deriv's public demo app_id, usable without registering your
  // own application — fine to leave as-is unless you've registered your
  // own app at api.deriv.com.
  DERIV_APP_ID: process.env.DERIV_APP_ID || '1089',
  DERIV_API_TOKEN: process.env.DERIV_API_TOKEN || '',

  // Deriv's own symbol names for forex/commodities use an "frx" prefix.
  // Defaults to the major FX pairs plus gold — comma-separated, so
  // add/remove pairs via .env without touching code.
  INSTRUMENTS: (process.env.INSTRUMENTS || 'frxEURUSD,frxGBPUSD,frxUSDJPY,frxAUDUSD,frxUSDCAD,frxUSDCHF,frxNZDUSD,frxEURGBP,frxEURJPY,frxGBPJPY,frxXAUUSD')
    .split(',').map(s => s.trim()).filter(Boolean),

  // Master switch — identical role to crypto-agents'/forex-agents' one.
  // Even with a real API token configured, no contract is ever bought
  // unless this is exactly "true". Anything else runs the full team
  // pipeline and logs what it *would* have done instead (paper trading).
  LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED === 'true',

  // Deriv gives every account (demo or real) a currency — USD is the
  // common default for a new demo account.
  ACCOUNT_CURRENCY: process.env.ACCOUNT_CURRENCY || 'USD',

  // Deriv's free demo accounts start with roughly 10,000 in virtual
  // balance by default — used here whenever not reading a real account
  // balance (paper mode, or no token configured yet).
  PAPER_STARTING_BALANCE: num('PAPER_STARTING_BALANCE', 10_000),

  // --- Risk policy ---
  PER_TRADE_RISK_PCT: num('PER_TRADE_RISK_PCT', 1), // % of free balance staked per trade
  // Deriv Multiplier contracts use a fixed "multiplier" instead of
  // traditional margin/leverage — kept low on purpose, same reasoning as
  // the other two teams' leverage settings. Only specific multiplier
  // values are accepted per instrument (commonly 5/10/20/30/50/100 for
  // forex, lower for some others) — Deriv will reject an unsupported
  // value; check your account's actual allowed multipliers if this errors.
  MULTIPLIER: num('MULTIPLIER', 10),
  // Risk:reward fixed at 1:3 — take-profit is exactly 3x the stop-loss
  // distance, expressed here as % price move (converted to the monetary
  // take_profit/stop_loss amounts Deriv's API actually wants — see
  // team/portfolio.js).
  STOP_LOSS_PCT: num('STOP_LOSS_PCT', 0.3),
  TAKE_PROFIT_PCT: num('TAKE_PROFIT_PCT', 0.9),
  MIN_BULL_CONFIDENCE: num('MIN_BULL_CONFIDENCE', 40),
  MAX_CONCURRENT_TRADES: num('MAX_CONCURRENT_TRADES', 0), // 0 = no cap, MAX_TOTAL_EXPOSURE_PCT is the real safety net
  MAX_TOTAL_EXPOSURE_PCT: num('MAX_TOTAL_EXPOSURE_PCT', 25),
  DAILY_LOSS_CAP_PCT: num('DAILY_LOSS_CAP_PCT', 3),
  TRADE_COOLDOWN_MIN: num('TRADE_COOLDOWN_MIN', 15),

  // --- Candles / signal timing ---
  CANDLE_GRANULARITY_SEC: num('CANDLE_GRANULARITY_SEC', 300), // 5-minute candles, same as the other two teams
  CANDLE_COUNT: num('CANDLE_COUNT', 250), // enough history for the EMA50/EMA200 trend filter
  POLL_INTERVAL_MS: num('POLL_INTERVAL_MS', 15_000),

  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  STATE_FILE: process.env.STATE_FILE || require('path').join(__dirname, 'data', 'state.json')
};

module.exports = config;
