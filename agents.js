const { ImapFlow } = require('imapflow');

function buildAgents(env) {
  return [
    {
      id: 'core',
      name: 'DeepSea (core)',
      async check() {
        return { connected: true };
      }
    },
    {
      id: 'mt5',
      name: 'MT5 Bridge',
      async check() {
        if (!env.VPS_STATUS_URL || !env.VPS_STATUS_KEY) {
          return { connected: false, reason: 'not configured' };
        }
        try {
          const res = await fetch(`${env.VPS_STATUS_URL}?key=${env.VPS_STATUS_KEY}`, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) return { connected: false, reason: `http ${res.status}` };
          const data = await res.json();
          return { connected: true, data };
        } catch (err) {
          console.error('MT5 status fetch failed:', err.message);
          return { connected: false, reason: err.message };
        }
      }
    },
    {
      id: 'gmail',
      name: 'Mercury · Gmail',
      async check() {
        if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
          return { connected: false, reason: 'not configured' };
        }
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
          let unreadCount = 0;
          let latest = null;
          try {
            const status = await client.status('INBOX', { unseen: true });
            unreadCount = status.unseen || 0;

            if (unreadCount > 0) {
              for await (const msg of client.fetch({ seen: false }, { envelope: true })) {
                latest = {
                  from: (msg.envelope.from && msg.envelope.from[0] && (msg.envelope.from[0].name || msg.envelope.from[0].address)) || 'unknown',
                  subject: msg.envelope.subject || '(no subject)'
                };
              }
            }
          } finally {
            lock.release();
          }
          await client.logout();
          return { connected: true, data: { unreadCount, latest } };
        } catch (err) {
          const reason = err.responseText || err.message;
          console.error('Gmail check failed:', reason);
          try { await client.logout(); } catch (e) {}
          return { connected: false, reason };
        }
      }
    },
    {
      id: 'whatsapp',
      name: 'Venus · WhatsApp',
      async check() {
        return { connected: false, reason: 'not configured' };
      }
    },
    {
      id: 'instagram',
      name: 'Mars · Instagram',
      async check() {
        return { connected: false, reason: 'not configured' };
      }
    },
    {
      id: 'youtube',
      name: 'Jupiter · YouTube',
      async check() {
        return { connected: false, reason: 'not configured' };
      }
    }
  ];
}

async function checkAllAgents(agents) {
  return Promise.all(
    agents.map(async agent => {
      const result = await agent.check();
      return { id: agent.id, name: agent.name, ...result };
    })
  );
}

module.exports = { buildAgents, checkAllAgents };
