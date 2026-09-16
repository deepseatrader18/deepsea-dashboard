const config = require('./config');

// Sends trade alerts straight to Telegram from this process — same
// direct-send pattern as crypto-agents/telegram.js, no WhatsApp, no Render.
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
  const dirTag = trade.direction === 'short' ? '🔻 SHORT' : '🔺 LONG';
  return (
    `${modeTag} — <b>${dirTag} ${escapeHtml(trade.instrument)}</b>\n\n` +
    `Stake: ${trade.margin} (${config.MULTIPLIER}x multiplier)\n` +
    `Entry: ${trade.entryPrice}\n` +
    `Target: ${trade.tpPrice}\n` +
    `Stop: ${trade.slStopPrice}`
  );
}

// totalCapital/totalProfit are account-wide numbers as of right after this
// trade closed — shown on every close so a running picture doesn't require
// checking anywhere else separately.
function formatTradeClose(trade, { totalCapital, totalProfit } = {}) {
  const won = trade.outcome === 'target_hit';
  const icon = won ? '✅' : '🛑';
  const modeTag = trade.mode === 'live' ? 'LIVE' : 'PAPER';
  const pnlSign = trade.pnlQuote >= 0 ? '+' : '';
  const totalProfitSign = typeof totalProfit === 'number' && totalProfit >= 0 ? '+' : '';
  return (
    `${icon} [${modeTag}] <b>${escapeHtml(trade.instrument)}</b> — ${won ? 'TARGET HIT' : 'STOPPED OUT'}\n\n` +
    `Exit: ${trade.exitPrice}\n` +
    `This trade P/L: ${pnlSign}${trade.pnlQuote.toFixed(2)}\n\n` +
    `Total capital: ${typeof totalCapital === 'number' ? totalCapital.toFixed(2) : 'n/a'}\n` +
    `Total profit (all-time): ${typeof totalProfit === 'number' ? `${totalProfitSign}${totalProfit.toFixed(2)}` : 'n/a'}`
  );
}

module.exports = { sendTelegramMessage, formatTradeOpen, formatTradeClose };
