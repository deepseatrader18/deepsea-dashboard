require('dotenv').config();

// Conservative-by-default risk policy (per the account owner's explicit
// choice: small per-trade risk, quick scalp exits, tight daily loss cap).
// Every value is overridable via .env so the owner can tune it later
// without touching code, but nothing here silently widens on its own.
function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  BINANCE_API_KEY: process.env.BINANCE_API_KEY || '',
  BINANCE_API_SECRET: process.env.BINANCE_API_SECRET || '',
  BINANCE_BASE_URL: process.env.BINANCE_BASE_URL || 'https://api.binance.com',

  // Master switch. Even with keys configured, orders are only ever placed
  // when this is exactly "true" — anything else (unset, "false", typo)
  // runs the full team pipeline and logs what it *would* have done
  // (paper mode) instead of touching the account. This is the single
  // switch to flip off in an emergency.
  LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED === 'true',

  QUOTE_ASSET: process.env.QUOTE_ASSET || 'USDT',

  // --- Position sizing & scalp targets (conservative defaults) ---
  PER_TRADE_RISK_PCT: num('PER_TRADE_RISK_PCT', 1), // % of free quote balance risked per trade
  TAKE_PROFIT_PCT: num('TAKE_PROFIT_PCT', 0.6), // quick scalp target
  STOP_LOSS_PCT: num('STOP_LOSS_PCT', 0.35), // tight stop, kept smaller than TP
  MAX_CONCURRENT_TRADES: num('MAX_CONCURRENT_TRADES', 2),
  DAILY_LOSS_CAP_PCT: num('DAILY_LOSS_CAP_PCT', 3), // halts new entries for the day once hit
  SYMBOL_COOLDOWN_MIN: num('SYMBOL_COOLDOWN_MIN', 15), // don't re-enter the same coin too soon

  // --- Volume scanner ---
  SCAN_INTERVAL_MS: num('SCAN_INTERVAL_MS', 20_000),
  VOLUME_HISTORY_LEN: num('VOLUME_HISTORY_LEN', 10),
  VOLUME_SURGE_MULTIPLIER: num('VOLUME_SURGE_MULTIPLIER', 3),
  MIN_QUOTE_VOLUME_24H: num('MIN_QUOTE_VOLUME_24H', 2_000_000), // ignore illiquid coins
  MIN_DELTA_QUOTE_VOLUME: num('MIN_DELTA_QUOTE_VOLUME', 50_000),

  // --- Reporting back to the Render dashboard (display only) ---
  DASHBOARD_URL: process.env.DASHBOARD_URL || 'https://deepsea-dashboard.onrender.com',
  BRIDGE_TOKEN: process.env.WHATSAPP_BRIDGE_TOKEN || process.env.CRYPTO_BRIDGE_TOKEN || '',
  REPORT_INTERVAL_MS: num('REPORT_INTERVAL_MS', 15_000),

  STATE_FILE: process.env.STATE_FILE || require('path').join(__dirname, 'data', 'state.json')
};

module.exports = config;
