require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const BRIDGE_TOKEN = process.env.WHATSAPP_BRIDGE_TOKEN;
const DASHBOARD_CHAT_URL = process.env.DASHBOARD_CHAT_URL || 'https://deepsea-dashboard.onrender.com';
const ALLOWED_CHAT_ID = process.env.ALLOWED_WHATSAPP_CHAT_ID || null;
const WAKE_WORD = 'deepsea';

if (!BRIDGE_TOKEN) {
  console.error('WHATSAPP_BRIDGE_TOKEN not set in .env — see .env.example. The same value must also be set as an env var on the deepsea-dashboard Render service.');
  process.exit(1);
}

// This is a self-bot: the WhatsApp Web session below logs in as your own
// account (scan the QR with your phone once, the session is then cached
// in .wwebjs_auth/ so you won't need to scan again). You then message
// yourself on WhatsApp ("Message Yourself" chat) starting with "deepsea"
// to talk to the dashboard's DeepSea assistant from your phone, anywhere.
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: { headless: true, args: ['--no-sandbox'] }
});

client.on('qr', qr => {
  console.log('\nScan this QR code with WhatsApp (Settings -> Linked Devices -> Link a Device). Only needed once — the session is cached after this.\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  const target = ALLOWED_CHAT_ID || '"Message Yourself"';
  console.log('DeepSea WhatsApp bridge is ready.');
  console.log(`Message ${target} on WhatsApp, starting with "${WAKE_WORD}", to talk to DeepSea from your phone.`);
});

client.on('auth_failure', msg => console.error('WhatsApp auth failed:', msg));
client.on('disconnected', reason => console.error('WhatsApp disconnected:', reason));

client.on('message_create', async msg => {
  // Only react to messages you send yourself (fromMe) into the allowed
  // chat, so no one else — in any other chat, including ones that message
  // you — can trigger it, and it never replies to messages other people
  // send you.
  if (!msg.fromMe) return;

  const chatId = msg.to;
  const isAllowedChat = ALLOWED_CHAT_ID ? chatId === ALLOWED_CHAT_ID : msg.from === msg.to;
  if (!isAllowedChat) return;

  const body = (msg.body || '').trim();
  if (!body.toLowerCase().startsWith(WAKE_WORD)) return;
  const commandText = body.slice(WAKE_WORD.length).trim() || body;

  console.log(`-> Command: ${commandText}`);
  const chat = await msg.getChat();

  try {
    const res = await fetch(`${DASHBOARD_CHAT_URL}/api/bridge/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-token': BRIDGE_TOKEN },
      body: JSON.stringify({ text: commandText }),
      signal: AbortSignal.timeout(30000)
    });
    const data = await res.json();
    await chat.sendMessage(data.reply || data.error || 'DeepSea se reply nahi mil paya.');
  } catch (err) {
    console.error('Bridge request failed:', err.message);
    await chat.sendMessage('DeepSea abhi available nahi hai, thodi der mein try karo.');
  }
});

client.initialize();
