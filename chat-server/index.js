// DeepSea Chat server: REST for accounts/chats + a WebSocket for realtime
// messages, delivery/read ticks, typing and online presence. State lives in
// memory and is snapshotted to Redis (REDIS_URL) or, without Redis, to a
// local JSON file — Render's free tier has no persistent disk, so set
// REDIS_URL there or chats are lost on every restart.
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3100;
const CHAT_SECRET = process.env.CHAT_SECRET || 'dev-only-secret-change-me';
const REDIS_URL = process.env.REDIS_URL;
const REDIS_KEY = 'deepsea-chat:state';
const DATA_FILE = path.join(__dirname, 'data.json');
const MAX_TEXT = 4000;

// ---------- state + persistence ----------
let state = { users: {}, chats: {}, messages: {} }; // messages: chatId -> [msg]
let redis = null;

async function loadState() {
  try {
    if (REDIS_URL) {
      const Redis = require('ioredis');
      redis = new Redis(REDIS_URL);
      const raw = await redis.get(REDIS_KEY);
      if (raw) state = JSON.parse(raw);
    } else if (fs.existsSync(DATA_FILE)) {
      state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load state, starting empty:', err.message);
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const raw = JSON.stringify(state);
    try {
      if (redis) await redis.set(REDIS_KEY, raw);
      else fs.writeFileSync(DATA_FILE, raw);
    } catch (err) {
      console.error('Failed to save state:', err.message);
    }
  }, 1000);
}

// ---------- auth ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function makeToken(userId) {
  const sig = crypto.createHmac('sha256', CHAT_SECRET).update(userId).digest('hex');
  return `${userId}.${sig}`;
}

function userFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [userId, sig] = token.split('.');
  if (!userId || !sig) return null;
  const expected = crypto.createHmac('sha256', CHAT_SECRET).update(userId).digest('hex');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return state.users[userId] || null;
}

function requireUser(req, res, next) {
  const header = req.get('authorization') || '';
  const user = userFromToken(header.replace(/^Bearer\s+/i, ''));
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.user = user;
  next();
}

// ---------- views ----------
const sockets = new Map(); // userId -> Set<ws>
const isOnline = (userId) => (sockets.get(userId)?.size || 0) > 0;

function publicUser(u) {
  return { id: u.id, phone: u.phone, name: u.name, about: u.about, online: isOnline(u.id), lastSeen: u.lastSeen };
}

function chatView(chat, forUserId) {
  const msgs = state.messages[chat.id] || [];
  const last = msgs[msgs.length - 1] || null;
  const unread = msgs.filter((m) => m.from !== forUserId && !m.readBy.includes(forUserId)).length;
  let title = chat.name;
  let peer = null;
  if (chat.type === 'direct') {
    const otherId = chat.members.find((id) => id !== forUserId) || forUserId;
    peer = state.users[otherId] ? publicUser(state.users[otherId]) : null;
    title = peer ? peer.name : 'Unknown';
  }
  return {
    id: chat.id,
    type: chat.type,
    title,
    peer,
    members: chat.members.map((id) => state.users[id]).filter(Boolean).map(publicUser),
    admin: chat.admin || null,
    lastMessage: last,
    unread,
    updatedAt: last ? last.ts : chat.createdAt,
  };
}

function sendTo(userId, event) {
  const set = sockets.get(userId);
  if (!set) return;
  const raw = JSON.stringify(event);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(raw);
}

function broadcastPresence(user) {
  const event = { type: 'presence', userId: user.id, online: isOnline(user.id), lastSeen: user.lastSeen };
  const notified = new Set();
  for (const chat of Object.values(state.chats)) {
    if (!chat.members.includes(user.id)) continue;
    for (const id of chat.members) {
      if (id !== user.id && !notified.has(id)) {
        notified.add(id);
        sendTo(id, event);
      }
    }
  }
}

// ---------- message receipts ----------
function emitReceipt(chat, msg) {
  const event = { type: 'receipt', chatId: chat.id, messageId: msg.id, deliveredTo: msg.deliveredTo, readBy: msg.readBy };
  for (const id of chat.members) sendTo(id, event);
}

function markDelivered(userId) {
  for (const chat of Object.values(state.chats)) {
    if (!chat.members.includes(userId)) continue;
    for (const msg of state.messages[chat.id] || []) {
      if (msg.from !== userId && !msg.deliveredTo.includes(userId)) {
        msg.deliveredTo.push(userId);
        emitReceipt(chat, msg);
      }
    }
  }
  scheduleSave();
}

function markRead(chat, userId) {
  for (const msg of state.messages[chat.id] || []) {
    if (msg.from === userId) continue;
    let changed = false;
    if (!msg.deliveredTo.includes(userId)) { msg.deliveredTo.push(userId); changed = true; }
    if (!msg.readBy.includes(userId)) { msg.readBy.push(userId); changed = true; }
    if (changed) emitReceipt(chat, msg);
  }
  scheduleSave();
}

function postMessage(chat, user, text, clientId) {
  const msg = {
    id: crypto.randomUUID(),
    clientId: clientId || null,
    chatId: chat.id,
    from: user.id,
    fromName: user.name,
    text,
    ts: Date.now(),
    deliveredTo: [],
    readBy: [],
  };
  for (const id of chat.members) {
    if (id !== user.id && isOnline(id)) msg.deliveredTo.push(id);
  }
  (state.messages[chat.id] ||= []).push(msg);
  scheduleSave();
  for (const id of chat.members) sendTo(id, { type: 'message', message: msg, chat: chatView(chat, id) });
  return msg;
}

// ---------- REST ----------
const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

app.post('/api/register', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const name = String(req.body.name || '').trim().slice(0, 50);
  const password = String(req.body.password || '');
  if (phone.replace('+', '').length < 6) return res.status(400).json({ error: 'Enter a valid phone number' });
  if (!name) return res.status(400).json({ error: 'Enter your name' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  if (Object.values(state.users).some((u) => u.phone === phone)) {
    return res.status(409).json({ error: 'This number is already registered — log in instead' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomUUID(),
    phone,
    name,
    about: 'Hey there! I am using DeepSea Chat.',
    salt,
    passHash: hashPassword(password, salt),
    lastSeen: Date.now(),
  };
  state.users[user.id] = user;
  scheduleSave();
  res.json({ token: makeToken(user.id), user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password || '');
  const user = Object.values(state.users).find((u) => u.phone === phone);
  if (!user || hashPassword(password, user.salt) !== user.passHash) {
    return res.status(401).json({ error: 'Wrong phone number or password' });
  }
  res.json({ token: makeToken(user.id), user: publicUser(user) });
});

app.get('/api/me', requireUser, (req, res) => res.json(publicUser(req.user)));

app.put('/api/me', requireUser, (req, res) => {
  if (typeof req.body.name === 'string' && req.body.name.trim()) req.user.name = req.body.name.trim().slice(0, 50);
  if (typeof req.body.about === 'string') req.user.about = req.body.about.trim().slice(0, 140);
  scheduleSave();
  res.json(publicUser(req.user));
});

app.get('/api/users', requireUser, (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const users = Object.values(state.users)
    .filter((u) => u.id !== req.user.id)
    .filter((u) => !q || u.name.toLowerCase().includes(q) || u.phone.includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 100)
    .map(publicUser);
  res.json(users);
});

app.get('/api/chats', requireUser, (req, res) => {
  const chats = Object.values(state.chats)
    .filter((c) => c.members.includes(req.user.id))
    .map((c) => chatView(c, req.user.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(chats);
});

app.post('/api/chats/direct', requireUser, (req, res) => {
  const other = state.users[req.body.userId];
  if (!other) return res.status(404).json({ error: 'User not found' });
  let chat = Object.values(state.chats).find(
    (c) => c.type === 'direct' && c.members.includes(req.user.id) && c.members.includes(other.id) &&
      (other.id !== req.user.id || c.members.length === 1)
  );
  if (!chat) {
    const members = other.id === req.user.id ? [req.user.id] : [req.user.id, other.id];
    chat = { id: crypto.randomUUID(), type: 'direct', name: null, members, createdAt: Date.now() };
    state.chats[chat.id] = chat;
    scheduleSave();
  }
  res.json(chatView(chat, req.user.id));
});

app.post('/api/chats/group', requireUser, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Group needs a name' });
  const ids = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
  const members = [...new Set([req.user.id, ...ids.filter((id) => state.users[id])])];
  if (members.length < 2) return res.status(400).json({ error: 'Pick at least one member' });
  const chat = { id: crypto.randomUUID(), type: 'group', name, members, admin: req.user.id, createdAt: Date.now() };
  state.chats[chat.id] = chat;
  postMessage(chat, req.user, `${req.user.name} created group "${name}"`);
  res.json(chatView(chat, req.user.id));
});

app.post('/api/chats/:id/leave', requireUser, (req, res) => {
  const chat = state.chats[req.params.id];
  if (!chat || chat.type !== 'group' || !chat.members.includes(req.user.id)) {
    return res.status(404).json({ error: 'Group not found' });
  }
  postMessage(chat, req.user, `${req.user.name} left`);
  chat.members = chat.members.filter((id) => id !== req.user.id);
  scheduleSave();
  res.json({ ok: true });
});

app.get('/api/chats/:id/messages', requireUser, (req, res) => {
  const chat = state.chats[req.params.id];
  if (!chat || !chat.members.includes(req.user.id)) return res.status(404).json({ error: 'Chat not found' });
  const before = Number(req.query.before) || Infinity;
  const msgs = (state.messages[chat.id] || []).filter((m) => m.ts < before);
  res.json(msgs.slice(-200));
});

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  const user = userFromToken(token);
  if (!user) {
    ws.close(4001, 'unauthorized');
    return;
  }
  const wasOnline = isOnline(user.id);
  if (!sockets.has(user.id)) sockets.set(user.id, new Set());
  sockets.get(user.id).add(ws);
  if (!wasOnline) broadcastPresence(user);
  markDelivered(user.id);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    const chat = state.chats[event.chatId];
    if (!chat || !chat.members.includes(user.id)) return;

    if (event.type === 'send') {
      const text = String(event.text || '').trim().slice(0, MAX_TEXT);
      if (text) postMessage(chat, user, text, event.clientId);
    } else if (event.type === 'typing') {
      for (const id of chat.members) {
        if (id !== user.id) sendTo(id, { type: 'typing', chatId: chat.id, userId: user.id, name: user.name });
      }
    } else if (event.type === 'read') {
      markRead(chat, user.id);
    }
  });

  ws.on('close', () => {
    sockets.get(user.id)?.delete(ws);
    if (!isOnline(user.id)) {
      user.lastSeen = Date.now();
      scheduleSave();
      broadcastPresence(user);
    }
  });
});

// Drop dead connections (phones that lost network) so presence stays honest.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

loadState().then(() => {
  server.listen(PORT, () => console.log(`DeepSea Chat server on :${PORT}`));
});
