const Redis = require('ioredis');

// DeepSea's persistent memory of the Boss — survives server restarts and
// is shared across every channel (dashboard voice, WhatsApp bridge), unlike
// the old per-login-session store which forgot everything on logout or
// redeploy. Backed by the same free Render Key-Value (Redis) instance
// already used by the Trade Journal. Single-user system, so fixed keys are
// enough — no per-account namespacing needed.
const RECENT_KEY = 'deepsea:memory:recent';
const SUMMARY_KEY = 'deepsea:memory:summary';

// Last N raw messages, kept for immediate conversational continuity (tone,
// what was just said). Older context still isn't lost — it lives on in the
// running summary below instead of growing the prompt forever.
const RECENT_MAX_MESSAGES = 40;

let client = null;
let clientUrl = null;

function getClient(env) {
  if (!env.REDIS_URL) return null;
  if (client && clientUrl === env.REDIS_URL) return client;
  if (client) client.disconnect();
  clientUrl = env.REDIS_URL;
  client = new Redis(clientUrl, { maxRetriesPerRequest: 2, connectTimeout: 5000 });
  client.on('error', err => console.error('DeepSea memory Redis error:', err.message));
  return client;
}

async function loadMemory(env) {
  const redis = getClient(env);
  if (!redis) return { recent: [], summary: '' };
  try {
    const [recentRaw, summary] = await Promise.all([redis.get(RECENT_KEY), redis.get(SUMMARY_KEY)]);
    return {
      recent: recentRaw ? JSON.parse(recentRaw) : [],
      summary: summary || ''
    };
  } catch (err) {
    console.error('DeepSea memory load failed:', err.message);
    return { recent: [], summary: '' };
  }
}

async function saveRecent(env, recent) {
  const redis = getClient(env);
  if (!redis) return;
  try {
    await redis.set(RECENT_KEY, JSON.stringify(recent.slice(-RECENT_MAX_MESSAGES)));
  } catch (err) {
    console.error('DeepSea memory save (recent) failed:', err.message);
  }
}

async function saveSummary(env, summary) {
  const redis = getClient(env);
  if (!redis) return;
  try {
    await redis.set(SUMMARY_KEY, summary);
  } catch (err) {
    console.error('DeepSea memory save (summary) failed:', err.message);
  }
}

module.exports = { loadMemory, saveRecent, saveSummary, RECENT_MAX_MESSAGES };
