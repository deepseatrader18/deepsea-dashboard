// ==UserScript==
// @name         DeepSea · TradingView trades → Telegram
// @namespace    deepsea-dashboard
// @version      1.1.0
// @description  Watches the Strategy Tester "List of trades" on your open TradingView chart and sends every new entry/exit to Telegram. Works on the free TradingView plan (no alerts/webhooks needed).
// @match        https://*.tradingview.com/chart/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.telegram.org
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_BOT_TOKEN = '';
  const DEFAULT_CHAT_ID = '';
  const SCAN_INTERVAL_MS = 3000;
  // Switching symbol/timeframe or editing strategy inputs rebuilds the whole
  // trade list — that's not a live trade, so a scan with this many changes
  // at once is treated as a reset instead of a burst of alerts.
  const MAX_CHANGES_PER_SCAN = 3;

  // ---- Telegram settings (asked once, stored in Tampermonkey) ----
  function getSettings(forceAsk) {
    // When installed from the dashboard (/tv-agent.user.js) these defaults
    // are filled in by the server, so nothing has to be typed.
    let token = GM_getValue('botToken', '') || DEFAULT_BOT_TOKEN;
    let chatId = GM_getValue('chatId', '') || DEFAULT_CHAT_ID;
    if (forceAsk || !token) {
      token = (prompt('DeepSea: Telegram BOT TOKEN daaliye', token) || '').trim();
      GM_setValue('botToken', token);
    }
    if (forceAsk || !chatId) {
      chatId = (prompt('DeepSea: Telegram CHAT ID daaliye', chatId) || '').trim();
      GM_setValue('chatId', chatId);
    }
    return { token, chatId };
  }

  // ---- SL/TP levels (the strategy draws them only as chart labels, which
  // the page can't read, so they're rebuilt from the entry price). Defaults
  // match the "Confirmed candle + S&D + BT&SP" labels on XAUUSD: SL = entry
  // ± 0.2%, TP1/TP2/TP3 = 0.5R / 1R / 1.5R.
  function getLevelSettings(forceAsk) {
    let slPct = GM_getValue('slPct', 0.2);
    let tpRs = GM_getValue('tpRs', '0.5, 1, 1.5');
    if (forceAsk) {
      const a = prompt('DeepSea: SL kitne % door hai entry se? (0 = SL/TP mat bhejo)', String(slPct));
      if (a !== null && !isNaN(parseFloat(a))) slPct = parseFloat(a);
      const b = prompt('DeepSea: TP kitne R par hain? (comma se alag, jaise 0.5, 1, 1.5)', tpRs);
      if (b !== null) tpRs = b;
      GM_setValue('slPct', slPct);
      GM_setValue('tpRs', tpRs);
    }
    const rs = String(tpRs).split(',').map(x => parseFloat(x)).filter(x => x > 0);
    return { slPct, rs };
  }

  GM_registerMenuCommand('Telegram settings badlo', () => getSettings(true));
  GM_registerMenuCommand('SL / TP settings badlo', () => getLevelSettings(true));
  GM_registerMenuCommand('Test message bhejo', () => send('✅ DeepSea TradingView agent chal raha hai.'));

  function send(text) {
    const { token, chatId } = getSettings(false);
    try { GM_notification({ title: 'DeepSea Trade', text, timeout: 8000 }); } catch (_) {}
    if (!token || !chatId) {
      console.warn('[DeepSea] Telegram not configured — only desktop notification shown');
      return;
    }
    GM_xmlhttpRequest({
      method: 'POST',
      url: `https://api.telegram.org/bot${token}/sendMessage`,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      onload: r => { if (r.status !== 200) console.error('[DeepSea] Telegram error', r.status, r.responseText); },
      onerror: e => console.error('[DeepSea] Telegram request failed', e)
    });
  }

  // ---- Reading the Strategy Tester trade list ----
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();

  // Find the trade list by its "Trade #" header instead of TradingView's CSS
  // class names, which change often.
  function findTradeRows() {
    const headers = Array.from(document.querySelectorAll('th, [role="columnheader"], div, span'))
      .filter(el => el.childElementCount === 0 && /^Trade\s*#/i.test(norm(el.textContent)));
    for (const h of headers) {
      const table = h.closest('table, [role="table"], [role="grid"]');
      if (!table) continue;
      const rows = Array.from(table.querySelectorAll('tbody tr, [role="row"]'));
      if (rows.length) return rows;
    }
    return null;
  }

  // Each trade starts with its trade number; rows without one (the second
  // line of a trade) belong to the trade above. Keyed by number so a trade
  // that gets its exit is caught as an update.
  function readTrades(rows) {
    const trades = new Map();
    let lastKey = null;
    for (const row of rows) {
      const text = norm(row.innerText || row.textContent);
      if (!text) continue;
      const m = text.match(/^(\d+)\s/);
      if (m) lastKey = m[1];
      if (!lastKey) continue;
      trades.set(lastKey, trades.has(lastKey) ? `${trades.get(lastKey)} | ${text}` : text);
    }
    return trades;
  }

  // An open trade's price/P&L columns tick constantly — compare trades with
  // the numbers stripped so only a real change (new trade, exit) triggers.
  const signature = text => text.replace(/[-+]?[\d.,:]+%?/g, '#');

  function chartSymbol() {
    return norm(document.title).split(' ')[0] || 'Chart';
  }

  const toNum = s => parseFloat(s.replace(/,/g, ''));

  // Current price from the tab title ("XAUUSD 4,161.540 ▲ ..."), used to tell
  // the entry price apart from dates, quantities and P&L in the trade row.
  function chartPrice() {
    const m = norm(document.title).match(/\d[\d,]*\.\d+/);
    return m ? toNum(m[0]) : NaN;
  }

  // Direction and entry price of a trade row; null if they can't be found.
  function parseEntry(text) {
    const dir = /\b(long|buy)\b/i.test(text) ? 1 : /\b(short|sell)\b/i.test(text) ? -1 : 0;
    const ref = chartPrice();
    if (!dir || !(ref > 0)) return null;
    for (const raw of text.match(/\d[\d,]*\.\d+/g) || []) {
      const v = toNum(raw);
      if (Math.abs(v - ref) / ref <= 0.03) {
        return { dir, entry: v, decimals: raw.split('.')[1].length };
      }
    }
    return null;
  }

  function levelLines(text) {
    const p = parseEntry(text);
    const { slPct, rs } = getLevelSettings(false);
    if (!p || !(slPct > 0)) return null;
    const risk = p.entry * slPct / 100;
    const f = v => v.toFixed(p.decimals);
    const lines = [
      `${p.dir === 1 ? '🟢 BUY ENTRY' : '🔴 SELL ENTRY'} · ${chartSymbol()}`,
      '',
      `Entry : ${f(p.entry)}`,
      `SL    : ${f(p.entry - p.dir * risk)}`
    ];
    rs.forEach((r, i) => lines.push(`TP${i + 1}   : ${f(p.entry + p.dir * risk * r)}`));
    return lines.join('\n');
  }

  function describe(text, isNew) {
    const t = text.toLowerCase();
    if (isNew) {
      const levels = levelLines(text);
      if (levels) return `${levels}\n\n${text}`;
    }
    let emoji = '📈';
    if (/exit|close/.test(t) && !isNew) emoji = '🏁';
    else if (/long|buy/.test(t)) emoji = '🟢';
    else if (/short|sell/.test(t)) emoji = '🔴';
    return `${emoji} DeepSea · ${chartSymbol()}\n${isNew ? 'NEW TRADE' : 'TRADE UPDATE'}\n\n${text}`;
  }

  let known = null;
  let warnedMissing = false;

  function scan() {
    const rows = findTradeRows();
    if (!rows) {
      if (!warnedMissing) {
        console.warn('[DeepSea] Strategy Tester "List of trades" nahi mila — panel khol kar "List of trades" tab chuniye');
        warnedMissing = true;
      }
      return;
    }
    warnedMissing = false;
    const current = readTrades(rows);
    if (!current.size) return;

    if (!known) {
      known = current;
      console.log(`[DeepSea] Watching ${current.size} trades on ${chartSymbol()}`);
      return;
    }

    const changes = [];
    for (const [key, text] of current) {
      if (!known.has(key)) changes.push({ text, isNew: true });
      else if (signature(known.get(key)) !== signature(text)) changes.push({ text, isNew: false });
    }

    if (changes.length > MAX_CHANGES_PER_SCAN) {
      console.log(`[DeepSea] ${changes.length} changes at once — list rebuilt (symbol/timeframe/settings change), resetting`);
    } else {
      for (const c of changes) send(describe(c.text, c.isNew));
    }
    known = current;
  }

  getSettings(false);
  setInterval(scan, SCAN_INTERVAL_MS);
})();
