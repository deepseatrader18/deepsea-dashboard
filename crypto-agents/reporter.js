const config = require('./config');

// Pushes a status snapshot to the Render dashboard so the Crypto Trading
// Room page shows real, live team activity — same shared-secret bridge
// pattern already used by the WhatsApp/laptop bridges (see
// desktop-assistant/) and the code-request mailbox in index.js. This is
// display-only: the dashboard never talks back into the trading loop.
async function reportStatus(payload) {
  if (!config.BRIDGE_TOKEN) return; // reporting is optional, trading still works without it
  try {
    await fetch(`${config.DASHBOARD_URL}/api/bridge/crypto-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-token': config.BRIDGE_TOKEN },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    console.error('Status report to dashboard failed (will retry next tick):', err.message);
  }
}

async function reportTrade(trade) {
  if (!config.BRIDGE_TOKEN) return;
  try {
    await fetch(`${config.DASHBOARD_URL}/api/bridge/crypto-trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-token': config.BRIDGE_TOKEN },
      body: JSON.stringify(trade),
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    console.error('Trade report to dashboard failed:', err.message);
  }
}

module.exports = { reportStatus, reportTrade };
