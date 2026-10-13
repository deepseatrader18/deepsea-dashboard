const { ImapFlow } = require('imapflow');
const cheerio = require('cheerio');
const { sendTelegramAlert, formatTradingViewAlert } = require('./telegramAlert');

// TradingView's free plan has no webhook alerts, but it can still email an
// alert. This polls the Gmail inbox for unread TradingView alert emails and
// forwards each one to Telegram, then marks it read so it's sent only once.
const POLL_INTERVAL_MS = 60 * 1000;
// On a cold start (Render free tier sleeps), don't replay a backlog of old
// alerts — anything older than this is just marked read and skipped.
const MAX_ALERT_AGE_MS = 15 * 60 * 1000;
const MAX_BODY_CHARS = 1500;

function findPart(node, type) {
  if (!node) return null;
  if (node.type === type && node.disposition !== 'attachment') return node.part || '1';
  for (const child of node.childNodes || []) {
    const found = findPart(child, type);
    if (found) return found;
  }
  return null;
}

async function readPart(client, uid, part) {
  const { content } = await client.download(uid, part, { uid: true });
  const chunks = [];
  for await (const chunk of content) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function htmlToText(html) {
  const $ = cheerio.load(html);
  $('style, script').remove();
  $('br').replaceWith('\n');
  $('p, div, tr, h1, h2, h3').each((_, el) => { $(el).append('\n'); });
  return $.text();
}

function cleanBody(text) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_BODY_CHARS);
}

// If the alert message itself is JSON (same format as the webhook alerts),
// render it as a structured signal; otherwise forward subject + text.
function formatEmailAlert(subject, body) {
  const jsonMatch = body.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === 'object') return formatTradingViewAlert(parsed);
    } catch (_) { /* not JSON */ }
  }
  return formatTradingViewAlert(`${subject}\n\n${body}`.trim());
}

async function pollOnce(env) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    logger: false
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false, from: 'tradingview.com' }, { uid: true });
      if (!uids || !uids.length) return;

      // Collect first — downloading inside the fetch iterator deadlocks imapflow.
      const messages = [];
      for await (const msg of client.fetch(uids, { envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
        messages.push(msg);
      }

      for (const msg of messages) {
        const sentAt = new Date(msg.internalDate || msg.envelope.date || 0).getTime();
        if (Date.now() - sentAt > MAX_ALERT_AGE_MS) {
          await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
          continue;
        }

        const subject = msg.envelope.subject || 'TradingView Alert';
        let body = '';
        const textPart = findPart(msg.bodyStructure, 'text/plain');
        const htmlPart = findPart(msg.bodyStructure, 'text/html');
        if (textPart) body = await readPart(client, msg.uid, textPart);
        else if (htmlPart) body = htmlToText(await readPart(client, msg.uid, htmlPart));

        const result = await sendTelegramAlert(env, formatEmailAlert(subject, cleanBody(body)));
        // Leave it unread on failure so the next poll retries it.
        if (result.ok) await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('TradingView email poll failed:', err.responseText || err.message);
  } finally {
    try { await client.logout(); } catch (e) {}
  }
}

function startTradingViewEmailForwarder(env) {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.log('TradingView email forwarder disabled (Gmail or Telegram not configured)');
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await pollOnce(env); } finally { running = false; }
  };
  setInterval(tick, POLL_INTERVAL_MS);
  tick();
}

module.exports = { startTradingViewEmailForwarder, formatEmailAlert };
