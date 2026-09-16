const config = require('./config');

// Sends trade alerts straight to Telegram from this process — not via
// WhatsApp, not via the Render dashboard (this is the only real-time
// notification channel by design). Every send is fire-and-forget from the
// caller's point of view: a slow/failed Telegram API call must never hold
// up the trading loop, so this never throws and is never awaited on the
// hot path.
async function sendTelegramMessage(text) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    console.error('Telegram send failed:', err.message);
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTradeOpen(trade) {
  const modeTag = trade.mode === 'live' ? '🔴 LIVE' : '📝 PAPER';
  return (
    `${modeTag} — <b>BUY ${escapeHtml(trade.symbol)}</b>\n\n` +
    `Qty: ${trade.qty}\n` +
    `Entry: ${trade.entryPrice}\n` +
    `Target: ${trade.tpPrice}\n` +
    `Stop: ${trade.slStopPrice}`
  );
}

function formatTradeClose(trade) {
  const won = trade.outcome === 'target_hit';
  const icon = won ? '✅' : '🛑';
  const modeTag = trade.mode === 'live' ? 'LIVE' : 'PAPER';
  const pnlSign = trade.pnlQuote >= 0 ? '+' : '';
  return (
    `${icon} [${modeTag}] <b>${escapeHtml(trade.symbol)}</b> — ${won ? 'TARGET HIT' : 'STOPPED OUT'}\n\n` +
    `Exit: ${trade.exitPrice}\n` +
    `P/L: ${pnlSign}${trade.pnlQuote.toFixed(2)}`
  );
}

module.exports = { sendTelegramMessage, formatTradeOpen, formatTradeClose };
