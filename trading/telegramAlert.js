// Fires a Telegram message when the Risk Manager approves a new trade — a
// live alert channel so the user doesn't have to keep the dashboard open to
// know when the pipeline has signed off on something.
async function sendTelegramAlert(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML'
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`Telegram alert failed: http ${res.status}${body ? `: ${body}` : ''}`);
    }
  } catch (err) {
    console.error('Telegram alert failed:', err.message);
  }
}

function formatTradeAlert(symbol, plan) {
  const d = plan.data;
  return (
    `🚨 <b>DeepSea Trade Signal</b>\n\n` +
    `<b>${symbol}</b> — <b>${d.action.toUpperCase()}</b> (${d.confidence} confidence)\n\n` +
    `Entry: ${d.entry}\n` +
    `Stop-Loss: ${d.stopLoss}\n` +
    `Take-Profit: ${d.takeProfit}\n` +
    `Risk:Reward — locked at 1:${plan.data.riskRewardRatio || 3}\n\n` +
    `${d.reasoning}`
  );
}

module.exports = { sendTelegramAlert, formatTradeAlert };
