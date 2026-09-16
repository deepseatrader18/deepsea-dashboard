require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { execSync, spawn } = require('child_process');
const path = require('path');

// Checks GitHub every few minutes for new commits and, if this pulls in
// changes under desktop-assistant/, installs them and restarts itself — so
// a code push (including from the automated coding-agent pipeline) reaches
// this laptop without anyone running git pull / npm install by hand. Any
// other repo change (dashboard, etc.) is still pulled to keep the local
// checkout in sync, just without a restart.
const PROJECT_DIR = path.join(__dirname, '..');
const SELF_UPDATE_CHECK_MS = 10 * 60 * 1000;

function git(args) {
  return execSync(`git ${args}`, { cwd: PROJECT_DIR, encoding: 'utf8' }).trim();
}

function checkForSelfUpdate() {
  try {
    const before = git('rev-parse HEAD');
    git('fetch origin main');
    const remote = git('rev-parse origin/main');
    if (before === remote) return;

    const changed = git(`diff --name-only ${before} ${remote}`);
    git('merge origin/main');

    if (!changed.includes('desktop-assistant/')) {
      console.log('-> Pulled a repo update (no changes for this bridge).');
      return;
    }

    console.log('-> New bridge update found — installing and restarting...');
    execSync('npm install --no-fund --no-audit', { cwd: __dirname, stdio: 'inherit' });

    const child = spawn(process.argv[0], [process.argv[1]], {
      cwd: __dirname,
      detached: true,
      stdio: 'inherit'
    });
    child.unref();
    process.exit(0);
  } catch (err) {
    console.error('Self-update check failed (will retry next cycle):', err.message);
  }
}

setInterval(checkForSelfUpdate, SELF_UPDATE_CHECK_MS);

// Instant coding path: if the user has installed and logged into Claude
// Code on this laptop (a one-time manual setup — see README) and then
// explicitly confirms with "haan", "code karo" requests run right here,
// instead of queueing on the cloud mailbox. Local means no network
// round-trip and no polling wait; the confirmation step means nothing on
// the real laptop ever runs unattended off a stray or misread message.
const LOCAL_CLAUDE_TIMEOUT_MS = 15 * 60 * 1000;

function isLocalClaudeCodeAvailable() {
  try {
    execSync('claude --version', { cwd: PROJECT_DIR, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runLocalClaudeCode(instruction) {
  return new Promise((resolve) => {
    const prompt = `You are DeepSea's local coding assistant, running directly on the user's own laptop with access to this git repository (deepsea-dashboard). The user explicitly confirmed this request, in their own words (Hindi/Hinglish):\n\n"${instruction}"\n\nImplement it on a feature branch (create one off latest main if needed) and commit your changes with a clear message. Never commit or push directly to main — push your branch and open a pull request for review instead, same as this repo's standing convention. If the request is unclear, unsafe, or outside this repo's scope, do not guess — explain why instead of acting. End your reply with one short line in Hindi/Hinglish summarizing what you did (or why not) and the PR link if you opened one, suitable to read aloud over WhatsApp.`;

    // Scoped tool allowlist, not --dangerously-skip-permissions: this can
    // edit files and run git/npm in the repo, but nothing broader (no
    // arbitrary shell, no system commands) — even after the user's "haan",
    // a misheard or ambiguous instruction can't do real damage outside
    // this project.
    const child = spawn('claude', [
      '-p', prompt,
      '--allowedTools', 'Read,Edit,Write,Glob,Grep,Bash(git *),Bash(npm *)'
    ], {
      cwd: PROJECT_DIR,
      env: process.env
    });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, summary: 'Time out ho gaya (15 min se zyada le rahi thi) — thoda chhota ya clear instruction try karo.' });
    }, LOCAL_CLAUDE_TIMEOUT_MS);

    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, summary: `Local Claude Code chalane mein error: ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, summary: out.trim().slice(-1500) || 'Ho gaya.' });
      } else {
        resolve({ ok: false, summary: (err || out).trim().slice(-1500) || `Exit code ${code}` });
      }
    });
  });
}

// Remembers the last chat the bridge saw a real command in, so the coding-
// agent result poller below (which has no incoming message to reply to)
// still knows where to proactively deliver its "ho gaya" message.
let lastChatId = ALLOWED_CHAT_ID || null;

const CODE_RESULT_POLL_MS = 30000;

async function checkForCodeResult() {
  if (!lastChatId) return; // haven't seen a message from the user yet this run
  try {
    const res = await fetch(`${DASHBOARD_CHAT_URL}/api/code-request/status`, {
      headers: { 'x-bridge-token': BRIDGE_TOKEN },
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    if (!data.ready) return;
    const header = data.ok ? 'Ho gaya, Boss' : 'Ye nahi ho paya, Boss';
    await sendAndTrack(lastChatId, `${header}\n"${data.text}"\n\n${data.summary || ''}`.trim());
  } catch (err) {
    console.error('Code-result poll failed:', err.message);
  }
}

setInterval(checkForCodeResult, CODE_RESULT_POLL_MS);

const BRIDGE_TOKEN = process.env.WHATSAPP_BRIDGE_TOKEN;
const DASHBOARD_CHAT_URL = process.env.DASHBOARD_CHAT_URL || 'https://deepsea-dashboard.onrender.com';
const ALLOWED_CHAT_ID = process.env.ALLOWED_WHATSAPP_CHAT_ID || null;
const LOCAL_ASSISTANT_URL = process.env.LOCAL_ASSISTANT_URL || 'http://127.0.0.1:8765';
const WAKE_WORD = 'deepsea';
const CONFIRM_WORDS = ['haan', 'ha', 'yes', 'confirm', 'confirm karo'];
const REMOTE_CONFIRM_WINDOW_MS = 60000;

// Set once a laptop command is matched (see the /command call below) and
// cleared on the next message either way — mirrors assistant.py's own
// "anything that isn't a clear yes counts as no" rule, just over WhatsApp
// instead of the mic.
let pendingCommand = null;

// Same idea, for a "code karo" instruction waiting on a "haan" before the
// local Claude Code agent (see below) is actually allowed to touch files.
let pendingCodeRequest = null;

// This is a self-bot in a self-chat, so every message the bridge itself
// sends (the "pakka?" prompt, "Ho gaya: ...", etc.) comes back through
// message_create exactly like a real reply from you would — fromMe is
// true for both. Without this, the bridge would read its own "pakka?"
// prompt as your answer and immediately cancel the command before you
// ever get to reply.
//
// sendAndTrack() records the exact text it's about to send *before*
// calling sendMessage(), not after: whatsapp-web.js fires message_create
// for an outgoing message before its sendMessage() promise resolves, so
// recording the id afterwards (tried first) lost the race almost every
// time. Matching on body text sidesteps that entirely.
const ownSentBodies = new Set();
async function sendAndTrack(to, text) {
  ownSentBodies.add(text);
  setTimeout(() => ownSentBodies.delete(text), 5 * 60 * 1000);
  return client.sendMessage(to, text);
}

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
  console.log(`[debug] message_create: fromMe=${msg.fromMe} from=${msg.from} to=${msg.to} body="${msg.body}"`);

  // Skip messages the bridge itself just sent (see ownSentBodies above) —
  // otherwise its own prompts and replies loop back in as if you'd typed them.
  if (ownSentBodies.has(msg.body)) {
    ownSentBodies.delete(msg.body);
    return;
  }

  // Only react to messages you send yourself (fromMe) into the allowed
  // chat, so no one else — in any other chat, including ones that message
  // you — can trigger it, and it never replies to messages other people
  // send you.
  if (!msg.fromMe) return;

  // Self-chat ("Message Yourself") detection: on older WhatsApp accounts
  // `from` and `to` are both your own @c.us id. On newer accounts WhatsApp
  // addresses the self-chat via a separate privacy-preserving @lid id, so
  // `from` (@c.us) and `to` (@lid) never match — treat any @lid recipient
  // as the self-chat too, since normal outgoing messages to real contacts
  // are always addressed via @c.us, not @lid.
  const chatId = msg.to;
  const isAllowedChat = ALLOWED_CHAT_ID
    ? chatId === ALLOWED_CHAT_ID
    : msg.from === msg.to || (chatId && chatId.endsWith('@lid'));
  if (!isAllowedChat) {
    console.log(`[debug] chat not allowed (expected ${ALLOWED_CHAT_ID || 'from===to'}, got from=${msg.from} to=${msg.to}) — skipping`);
    return;
  }
  lastChatId = chatId;

  const body = (msg.body || '').trim();
  const lower = body.toLowerCase();

  // A "code karo" request is waiting on a "haan" before the local Claude
  // Code agent is allowed to run — checked ahead of pendingCommand since
  // only one thing is ever pending at a time.
  if (pendingCodeRequest && Date.now() < pendingCodeRequest.expiresAt) {
    const pending = pendingCodeRequest;
    pendingCodeRequest = null;
    const isConfirm = CONFIRM_WORDS.some(w => lower === w || lower.startsWith(w + ' '));
    if (!isConfirm) {
      console.log(`[debug] pending code request cancelled by reply: "${body}"`);
      await sendAndTrack(msg.to, `Cancelled: ${pending.instruction}`);
      return;
    }
    await sendAndTrack(msg.to, `Ji Boss, ab shuru kar rahi hoon: "${pending.instruction}". Ho jaane par batati hoon.`);
    runLocalClaudeCode(pending.instruction).then(async (result) => {
      const header = result.ok ? 'Ho gaya, Boss' : 'Ye nahi ho paya, Boss';
      await sendAndTrack(msg.to, `${header}\n${result.summary}`);
    });
    return;
  }

  // A laptop command is waiting on a "haan" — this reply doesn't need the
  // "deepsea" wake word again, same as it wouldn't need it a second time
  // when confirming by voice.
  if (pendingCommand && Date.now() < pendingCommand.expiresAt) {
    const pending = pendingCommand;
    pendingCommand = null;
    const isConfirm = CONFIRM_WORDS.some(w => lower === w || lower.startsWith(w + ' '));
    if (!isConfirm) {
      console.log(`[debug] pending command cancelled by reply: "${body}"`);
      await sendAndTrack(msg.to, `Cancelled: ${pending.description}`);
      return;
    }
    try {
      const res = await fetch(`${LOCAL_ASSISTANT_URL}/confirm`, {
        method: 'POST',
        headers: { 'x-bridge-token': BRIDGE_TOKEN },
        signal: AbortSignal.timeout(15000)
      });
      const data = await res.json();
      await sendAndTrack(msg.to, data.ok ? `Ho gaya: ${data.description}` : `Cancelled (time out ho gaya): ${pending.description}`);
    } catch (err) {
      console.error('Confirm request to local assistant failed:', err.message);
      await sendAndTrack(msg.to, 'Laptop assistant se connect nahi ho paaya — check karo ki python assistant.py laptop par chal raha hai.');
    }
    return;
  }

  if (!lower.startsWith(WAKE_WORD)) {
    console.log(`[debug] no wake word "${WAKE_WORD}" — skipping`);
    return;
  }
  const commandText = body.slice(WAKE_WORD.length).trim() || body;

  console.log(`-> Command: ${commandText}`);

  // "deepsea code karo: ..." / "deepsea code: ..." hands a coding/design
  // instruction to a local Claude Code agent on this laptop, but only after
  // an explicit "haan" (see pendingCodeRequest above) — never unattended.
  // Falls back to the old cloud mailbox (checked roughly hourly by a
  // separate Claude Code Routine, no confirmation needed since it only
  // opens a PR for review) if Claude Code isn't set up on this machine yet.
  const codeMatch = commandText.match(/^code\s*(?:karo)?\s*:?\s*(.+)/i);
  if (codeMatch) {
    const instruction = codeMatch[1].trim();

    if (isLocalClaudeCodeAvailable()) {
      pendingCodeRequest = { instruction, expiresAt: Date.now() + REMOTE_CONFIRM_WINDOW_MS };
      await sendAndTrack(msg.to, `Aapne bola: "${instruction}". Isse local Claude Code se turant karwau? 60 second ke andar "haan" likho.`);
      return;
    }

    try {
      await fetch(`${DASHBOARD_CHAT_URL}/api/bridge/code-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bridge-token': BRIDGE_TOKEN },
        body: JSON.stringify({ text: instruction }),
        signal: AbortSignal.timeout(10000)
      });
      await sendAndTrack(msg.to, `Ji Boss, ye coding request note kar li: "${instruction}". Agle check (~1 ghante mein) mein isse kaam shuru karungi, ho jaane par bata dungi.`);
    } catch (err) {
      console.error('Code-request submit failed:', err.message);
      await sendAndTrack(msg.to, 'Coding request submit nahi ho payi — dashboard se connect nahi ho pa raha, thodi der mein try karo.');
    }
    return;
  }

  // Try it as a laptop command first (Chrome, lock, media, etc. — the same
  // things assistant.py understands by voice). If assistant.py isn't
  // running, or the text doesn't match any known command, this falls
  // through to the normal dashboard chat reply below.
  try {
    const res = await fetch(`${LOCAL_ASSISTANT_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-token': BRIDGE_TOKEN },
      body: JSON.stringify({ text: commandText }),
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.matched) {
        pendingCommand = { description: data.description, expiresAt: Date.now() + REMOTE_CONFIRM_WINDOW_MS };
        await sendAndTrack(msg.to, `Aapne bola: "${commandText}". ${data.description} — pakka? 60 second ke andar "haan" likho.`);
        return;
      }
    }
  } catch (err) {
    console.log(`[debug] local assistant not reachable (${err.message}) — falling back to dashboard chat`);
  }

  // sendAndTrack(chatId, text) instead of msg.getChat() + chat.sendMessage():
  // getChatById() throws on @lid-addressed chats on this whatsapp-web.js
  // version (confirmed by the crash in Client.getChatById), and since that
  // crash happened outside any try/catch it took the whole process down —
  // sendMessage() takes the chat id directly and doesn't need that lookup,
  // and everything here is now inside try/catch so a future failure logs
  // instead of crashing the bridge.
  try {
    const res = await fetch(`${DASHBOARD_CHAT_URL}/api/bridge/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-token': BRIDGE_TOKEN },
      body: JSON.stringify({ text: commandText }),
      signal: AbortSignal.timeout(30000)
    });
    const data = await res.json();
    await sendAndTrack(msg.to, data.reply || data.error || 'DeepSea se reply nahi mil paya.');
  } catch (err) {
    console.error('Bridge request failed:', err.message);
    try {
      await sendAndTrack(msg.to, 'DeepSea abhi available nahi hai, thodi der mein try karo.');
    } catch (sendErr) {
      console.error('Could not even send the error reply:', sendErr.message);
    }
  }
});

// A real OS sleep/resume on the laptop (e.g. from the "sleep mode par
// dalo" command) can leave the underlying WhatsApp Web/Puppeteer session
// broken — Chromium pauses along with the OS, and its CDP connection
// often doesn't survive the resume ("Attempted to use detached Frame").
// Once that happens every client.* call fails forever, so instead of just
// logging and staying half-alive, restart the whole process: a fresh
// browser session reuses the cached WhatsApp login (no QR needed) and
// recovers on its own, without anyone having to notice and restart it by hand.
let restartingAfterCrash = false;
process.on('unhandledRejection', err => {
  console.error('Unhandled error — restarting bridge to recover:', err);
  if (restartingAfterCrash) return;
  restartingAfterCrash = true;
  setTimeout(() => {
    const child = spawn(process.argv[0], [process.argv[1]], {
      cwd: __dirname,
      detached: true,
      stdio: 'inherit'
    });
    child.unref();
    process.exit(1);
  }, 3000);
});

client.initialize();
