// Fires a Telegram message when the Risk Manager approves a new trade — a
// live alert channel so the user doesn't have to keep the dashboard open to
// know when the pipeline has signed off on something.
async function sendTelegramAlert(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { ok: false, reason: 'not configured' };
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
      const reason = `http ${res.status}${body ? `: ${body}` : ''}`;
      console.error(`Telegram alert failed: ${reason}`);
      return { ok: false, reason };
    }
    return { ok: true };
  } catch (err) {
    console.error('Telegram alert failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

// The reasoning text is agent-generated and can contain things like
// "EMA9 <= EMA50" — with parse_mode HTML, a bare "<" is read as the start
// of a tag, so Telegram rejects the whole message (400: can't parse
// entities). Escape any dynamic text before it goes into the HTML message;
// the literal <b> tags below are ours, not escaped.
function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTradeAlert(symbol, plan) {
  const d = plan.data;
  return (
    `🚨 <b>DeepSea Trade Signal</b>\n\n` +
    `<b>${escapeHtml(symbol)}</b> — <b>${escapeHtml(d.action.toUpperCase())}</b> (${escapeHtml(d.confidence)} confidence)\n\n` +
    `Entry: ${d.entry}\n` +
    `Stop-Loss: ${d.stopLoss}\n` +
    `Take-Profit: ${d.takeProfit}\n` +
    `Risk:Reward — locked at 1:${plan.data.riskRewardRatio || 3}\n\n` +
    `${escapeHtml(d.reasoning)}`
  );
}

// TradingView strategy/indicator alerts arrive via webhook, either as the
// JSON the user wrote into the alert's Message box or as plain text (e.g.
// the default "{{strategy.order.action}} @ {{strategy.order.price}}" message).
// JSON is rendered as a structured signal; anything else is forwarded as-is.
function formatTradingViewAlert(payload) {
  if (typeof payload === 'string') {
    const text = payload.trim();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return formatTradingViewAlert(parsed);
    } catch (_) { /* not JSON — send the raw text */ }
    return `📈 <b>TradingView Alert</b>\n\n${escapeHtml(text || '(empty message)')}`;
  }

  const p = payload || {};
  const pick = (...keys) => {
    for (const k of keys) if (p[k] !== undefined && p[k] !== null && p[k] !== '') return p[k];
    return undefined;
  };
  const action = pick('action', 'side', 'signal', 'order');
  const symbol = pick('ticker', 'symbol', 'pair');
  const known = {
    Strategy: pick('strategy', 'name'),
    Timeframe: pick('interval', 'timeframe', 'tf'),
    Price: pick('price', 'close', 'entry'),
    'Stop-Loss': pick('sl', 'stopLoss', 'stop_loss'),
    'Take-Profit': pick('tp', 'takeProfit', 'take_profit'),
    Contracts: pick('contracts', 'qty', 'quantity'),
    Position: pick('position', 'market_position'),
    Comment: pick('comment', 'message', 'note')
  };
  const actionText = action !== undefined ? String(action).toUpperCase() : '';
  const emoji = /BUY|LONG/.test(actionText) ? '🟢' : /SELL|SHORT/.test(actionText) ? '🔴' : '📈';

  let msg = `${emoji} <b>TradingView Signal</b>\n\n`;
  if (symbol !== undefined || actionText) {
    msg += [symbol !== undefined ? `<b>${escapeHtml(symbol)}</b>` : '', actionText ? `<b>${escapeHtml(actionText)}</b>` : '']
      .filter(Boolean).join(' — ') + '\n\n';
  }
  for (const [label, value] of Object.entries(known)) {
    if (value !== undefined) msg += `${label}: ${escapeHtml(value)}\n`;
  }
  return msg.trimEnd();
}

module.exports = { sendTelegramAlert, formatTradeAlert, formatTradingViewAlert };
