require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { execSync, spawn } = require('child_process');
const path = require('path');

// Backup channel for DeepSea, alongside whatsapp-bridge.js. Discord's bot
// API is official (no browser automation, no self-bot hacks), so it isn't
// exposed to the WhatsApp bridge's "sleep/resume breaks Puppeteer" failure
// mode — useful as a fallback when that bridge is down, or just as a
// second way to reach DeepSea.
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

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const BRIDGE_TOKEN = process.env.WHATSAPP_BRIDGE_TOKEN;
const DASHBOARD_CHAT_URL = process.env.DASHBOARD_CHAT_URL || 'https://deepsea-dashboard.onrender.com';
const LOCAL_ASSISTANT_URL = process.env.LOCAL_ASSISTANT_URL || 'http://127.0.0.1:8765';
const ALLOWED_DISCORD_USER_ID = process.env.ALLOWED_DISCORD_USER_ID || null;
const WAKE_WORD = 'deepsea';
const CONFIRM_WORDS = ['haan', 'ha', 'yes', 'confirm', 'confirm karo'];
const CONFIRM_WINDOW_MS = 60000;
const LOCAL_CLAUDE_TIMEOUT_MS = 15 * 60 * 1000;

if (!DISCORD_BOT_TOKEN) {
  console.log('DISCORD_BOT_TOKEN not set in .env — Discord bridge is optional, skipping (see .env.example).');
  process.exit(0);
}
if (!BRIDGE_TOKEN) {
  console.error('WHATSAPP_BRIDGE_TOKEN not set in .env — the Discord bridge needs the same shared token.');
  process.exit(1);
}

// Same two-step pattern as whatsapp-bridge.js: a "code karo" or laptop
// command asks for a "haan" before it actually runs anything.
let pendingCommand = null;
let pendingCodeRequest = null;

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
    const prompt = `You are DeepSea's local coding assistant, running directly on the user's own laptop with access to this git repository (deepsea-dashboard). The user explicitly confirmed this request, in their own words (Hindi/Hinglish):\n\n"${instruction}"\n\nImplement it on a feature branch (create one off latest main if needed) and commit your changes with a clear message. Never commit or push directly to main — push your branch and open a pull request for review instead, same as this repo's standing convention. If the request is unclear, unsafe, or outside this repo's scope, do not guess — explain why instead of acting. End your reply with one short line in Hindi/Hinglish summarizing what you did (or why not) and the PR link if you opened one, suitable to post as a Discord message.`;

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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`DeepSea Discord bridge is ready, logged in as ${client.user.tag}.`);
  if (!ALLOWED_DISCORD_USER_ID) {
    console.log('ALLOWED_DISCORD_USER_ID is not set — anyone who can message this bot will be able to command it. Set it in .env (see .env.example).');
  }
});

// Remembers the last channel a real command came in on, so the volume-alert
// poller below (which has no incoming message to reply to) knows where to
// proactively post.
let lastChannel = null;

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (ALLOWED_DISCORD_USER_ID && msg.author.id !== ALLOWED_DISCORD_USER_ID) return;
  lastChannel = msg.channel;

  const body = (msg.content || '').trim();
  const lower = body.toLowerCase();

  if (pendingCodeRequest && Date.now() < pendingCodeRequest.expiresAt) {
    const pending = pendingCodeRequest;
    pendingCodeRequest = null;
    const isConfirm = CONFIRM_WORDS.some(w => lower === w || lower.startsWith(w + ' '));
    if (!isConfirm) {
      await msg.reply(`Cancelled: ${pending.instruction}`);
      return;
    }
    await msg.reply(`Ji Boss, ab shuru kar rahi hoon: "${pending.instruction}". Ho jaane par batati hoon.`);
    runLocalClaudeCode(pending.instruction).then(async (result) => {
      const header = result.ok ? 'Ho gaya, Boss' : 'Ye nahi ho paya, Boss';
      await msg.channel.send(`${header}\n${result.summary}`);
    });
    return;
  }

  if (pendingCommand && Date.now() < pendingCommand.expiresAt) {
    const pending = pendingCommand;
    pendingCommand = null;
    const isConfirm = CONFIRM_WORDS.some(w => lower === w || lower.startsWith(w + ' '));
    if (!isConfirm) {
      await msg.reply(`Cancelled: ${pending.description}`);
      return;
    }
    try {
      const res = await fetch(`${LOCAL_ASSISTANT_URL}/confirm`, {
        method: 'POST',
        headers: { 'x-bridge-token': BRIDGE_TOKEN },
        signal: AbortSignal.timeout(15000)
      });
      const data = await res.json();
      await msg.reply(data.ok ? `Ho gaya: ${data.description}` : `Cancelled (time out ho gaya): ${pending.description}`);
    } catch (err) {
      console.error('Confirm request to local assistant failed:', err.message);
      await msg.reply('Laptop assistant se connect nahi ho paaya — check karo ki python assistant.py laptop par chal raha hai.');
    }
    return;
  }

  if (!lower.startsWith(WAKE_WORD)) return;
  const commandText = body.slice(WAKE_WORD.length).trim() || body;

  console.log(`-> Command (Discord): ${commandText}`);

  // Same "code karo" handling as whatsapp-bridge.js: local Claude Code
  // after an explicit "haan", falling back to the hourly cloud mailbox if
  // Claude Code isn't set up on this laptop yet.
  const codeMatch = commandText.match(/^code\s*(?:karo)?\s*:?\s*(.+)/i);
  if (codeMatch) {
    const instruction = codeMatch[1].trim();

    if (isLocalClaudeCodeAvailable()) {
      pendingCodeRequest = { instruction, expiresAt: Date.now() + CONFIRM_WINDOW_MS };
      await msg.reply(`Aapne bola: "${instruction}". Isse local Claude Code se turant karwau? 60 second ke andar "haan" likho.`);
      return;
    }

    try {
      await fetch(`${DASHBOARD_CHAT_URL}/api/bridge/code-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bridge-token': BRIDGE_TOKEN },
        body: JSON.stringify({ text: instruction }),
        signal: AbortSignal.timeout(10000)
      });
      await msg.reply(`Ji Boss, ye coding request note kar li: "${instruction}". (Local turant-wala setup abhi is laptop par nahi hua, isliye agle cloud check (~1 ghante mein) mein shuru hogi.) Ho jaane par bata dungi.`);
    } catch (err) {
      console.error('Code-request submit failed:', err.message);
      await msg.reply('Coding request submit nahi ho payi — dashboard se connect nahi ho pa raha, thodi der mein try karo.');
    }
    return;
  }

  // Try it as a laptop command first, same as whatsapp-bridge.js.
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
        pendingCommand = { description: data.description, expiresAt: Date.now() + CONFIRM_WINDOW_MS };
        await msg.reply(`Aapne bola: "${commandText}". ${data.description} — pakka? 60 second ke andar "haan" likho.`);
        return;
      }
    }
  } catch (err) {
    console.log(`[debug] local assistant not reachable (${err.message}) — falling back to dashboard chat`);
  }

  try {
    const res = await fetch(`${DASHBOARD_CHAT_URL}/api/bridge/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-token': BRIDGE_TOKEN },
      body: JSON.stringify({ text: commandText }),
      signal: AbortSignal.timeout(30000)
    });
    const data = await res.json();
    await msg.reply(data.reply || data.error || 'DeepSea se reply nahi mil paya.');
  } catch (err) {
    console.error('Bridge request failed:', err.message);
    await msg.reply('DeepSea abhi available nahi hai, thodi der mein try karo.');
  }
});

process.on('unhandledRejection', err => {
  console.error('Unhandled error in Discord bridge:', err);
});

// Binance volume-surge alerts (scanner runs server-side, see index.js) —
// delivered the same proactive way as elsewhere, to whichever channel last
// saw a real command.
const VOLUME_ALERT_POLL_MS = 30000;
let lastVolumeAlertTs = Date.now(); // skip historical backlog on startup

async function checkForVolumeAlerts() {
  if (!lastChannel) return;
  try {
    const res = await fetch(`${DASHBOARD_CHAT_URL}/api/bridge/volume-alerts?since=${lastVolumeAlertTs}`, {
      headers: { 'x-bridge-token': BRIDGE_TOKEN },
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    for (const alert of (data.alerts || [])) {
      lastVolumeAlertTs = Math.max(lastVolumeAlertTs, alert.createdAt);
      await lastChannel.send(`Boss, ${alert.message}`);
    }
    if (typeof data.now === 'number') lastVolumeAlertTs = Math.max(lastVolumeAlertTs, data.now - 1);
  } catch (err) {
    console.error('Volume-alert poll failed:', err.message);
  }
}

setInterval(checkForVolumeAlerts, VOLUME_ALERT_POLL_MS);

client.login(DISCORD_BOT_TOKEN);
