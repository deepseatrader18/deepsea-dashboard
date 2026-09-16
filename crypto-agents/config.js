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
  FUTURES_BASE_URL: process.env.FUTURES_BASE_URL || 'https://fapi.binance.com',

  // Trading now happens on Binance USDT-M Futures, not Spot — Spot can
  // only ever sell what it already owns, so a genuine short (sell first,
  // buy back later) requires Futures. Scanning for volume surges still
  // uses Spot's WebSocket (broader coin coverage), but only symbols that
  // also have a Futures perpetual are actually tradable; everything else
  // is skipped. Kept deliberately low per the account owner's explicit
  // choice — low leverage means the account's own stop-loss will always
  // fire long before Binance's liquidation price would ever be reached.
  FUTURES_LEVERAGE: num('FUTURES_LEVERAGE', 3),

  // Master switch. Even with keys configured, orders are only ever placed
  // when this is exactly "true" — anything else (unset, "false", typo)
  // runs the full team pipeline and logs what it *would* have done
  // (paper mode) instead of touching the account. This is the single
  // switch to flip off in an emergency.
  LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED === 'true',

  QUOTE_ASSET: process.env.QUOTE_ASSET || 'USDT',

  // Simulated starting capital used whenever the team isn't reading a real
  // Binance balance (paper mode, or no API key configured yet) — set this
  // to whatever amount you actually plan to trade with once live, so the
  // paper results (win rate, P/L) mean something for that real capital
  // size instead of an arbitrary number.
  PAPER_STARTING_BALANCE: num('PAPER_STARTING_BALANCE', 1000),

  // --- Position sizing & scalp targets (conservative defaults) ---
  PER_TRADE_RISK_PCT: num('PER_TRADE_RISK_PCT', 1), // % of free quote balance risked per trade
  // Widened slightly from the original 0.6/0.35 after real paper-trading
  // showed the stop was tight enough to catch normal post-spike noise, not
  // just genuine reversals — same ~1.7:1 reward:risk ratio, more room.
  TAKE_PROFIT_PCT: num('TAKE_PROFIT_PCT', 0.8), // quick scalp target
  STOP_LOSS_PCT: num('STOP_LOSS_PCT', 0.5), // tight stop, kept smaller than TP
  // After a surge is detected, wait this long and re-check price before
  // actually entering — buying the instant a surge is seen means buying
  // the exact top of the spike, right before the pullback that was
  // tripping the stop-loss almost every time. A short pause lets a real
  // pullback/stabilization show up before committing capital.
  ENTRY_CONFIRM_DELAY_MS: num('ENTRY_CONFIRM_DELAY_MS', 8_000),
  // If price is still running further away by more than this much during
  // the confirmation wait, the move hasn't paused at all — skip it rather
  // than chase.
  ENTRY_MAX_CHASE_PCT: num('ENTRY_MAX_CHASE_PCT', 0.15),
  // Minimum average confidence (0-100) the two researchers must show
  // together before the Bull Debater will support entry — fewer, higher-
  // conviction trades rather than acting on every borderline agreement.
  MIN_BULL_CONFIDENCE: num('MIN_BULL_CONFIDENCE', 40),
  // 0 (or any non-positive value) means no cap — trade every coin that
  // clears the team's bar, however many that is. Capital still
  // self-limits this in practice: free balance shrinks as positions open
  // (see state.js's paper-balance reservation / balanceCache.js for live),
  // so Position Sizer starts rejecting new trades once free balance drops
  // below the exchange's minimum order size.
  MAX_CONCURRENT_TRADES: num('MAX_CONCURRENT_TRADES', 2),
  // Hard ceiling on how much capital can be tied up across ALL open
  // positions at once, as a % of the day's starting balance — this is
  // what actually keeps the account safe when MAX_CONCURRENT_TRADES is
  // uncapped: trade on as many coins as clear the bar, but never let more
  // than this fraction of the account be at risk at the same moment.
  MAX_TOTAL_EXPOSURE_PCT: num('MAX_TOTAL_EXPOSURE_PCT', 25),
  DAILY_LOSS_CAP_PCT: num('DAILY_LOSS_CAP_PCT', 3), // halts new entries for the day once hit
  SYMBOL_COOLDOWN_MIN: num('SYMBOL_COOLDOWN_MIN', 15), // don't re-enter the same coin too soon
  // If live price gaps down past the stop-loss trigger by more than this
  // without the OCO's stop leg actually filling (a fast/illiquid drop can
  // jump straight through a stop-limit order), monitor.js force-closes the
  // position with an emergency market sell instead of leaving it exposed.
  GAP_PROTECTION_BUFFER_PCT: num('GAP_PROTECTION_BUFFER_PCT', 1),

  // --- Volume scanner ---
  // Scanning itself is WebSocket-driven (wsScanner.js), not polled — Binance
  // pushes a full-market ticker update roughly once a second, so a surge is
  // seen within about a second of it happening instead of waiting for a
  // REST poll interval. SCAN_INTERVAL_MS only matters if WS_SCANNER_ENABLED
  // is turned off and the slower REST fallback (scanner.js) is used instead.
  WS_SCANNER_ENABLED: process.env.WS_SCANNER_ENABLED !== 'false',
  SCAN_INTERVAL_MS: num('SCAN_INTERVAL_MS', 20_000),
  // Rolling window length is in "ticks" — ~1s apart on the WS stream, so
  // 30 is roughly a 30-second baseline instead of scanner.js's old ~10x20s.
  VOLUME_HISTORY_LEN: num('VOLUME_HISTORY_LEN', 30),
  VOLUME_SURGE_MULTIPLIER: num('VOLUME_SURGE_MULTIPLIER', 3),
  MIN_QUOTE_VOLUME_24H: num('MIN_QUOTE_VOLUME_24H', 2_000_000), // ignore illiquid coins
  MIN_DELTA_QUOTE_VOLUME: num('MIN_DELTA_QUOTE_VOLUME', 10_000), // smaller per-second deltas than the old 20s polling window

  // How often open positions are checked for their exit and a status
  // snapshot is sent to the dashboard. This is just bookkeeping speed, not
  // trading speed — the actual take-profit/stop-loss order already sits on
  // Binance's own matching engine (via OCO) and fires instantly regardless
  // of this interval.
  POSITION_TICK_MS: num('POSITION_TICK_MS', 3_000),
  // How often a live account balance is re-synced from Binance to correct
  // for fee drift — the trading decision path itself uses an in-memory
  // balance updated instantly after every trade, never waiting on this.
  BALANCE_RESYNC_MS: num('BALANCE_RESYNC_MS', 2 * 60_000),

  // --- Telegram trade alerts (sent directly from here, not via Render) ---
  // Every BUY, every target-hit, every stopped-out gets its own message —
  // no WhatsApp, no other channel. Use the same bot/chat you may already
  // have set up for the forex alerts on the Render dashboard, or a
  // separate one — either works, this just needs its own copy of the
  // values since this process runs independently on your VPS.
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  // --- Reporting status/trades to the Render dashboard's Crypto Trading
  //     Room page (display only, optional, independent of Telegram) ---
  DASHBOARD_URL: process.env.DASHBOARD_URL || 'https://deepsea-dashboard.onrender.com',
  BRIDGE_TOKEN: process.env.CRYPTO_BRIDGE_TOKEN || '',
  REPORT_INTERVAL_MS: num('REPORT_INTERVAL_MS', 15_000),

  STATE_FILE: process.env.STATE_FILE || require('path').join(__dirname, 'data', 'state.json')
};

module.exports = config;
