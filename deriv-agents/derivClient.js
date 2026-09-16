const WebSocket = require('ws');
const config = require('./config');

// Deriv's API is a single persistent WebSocket connection carrying JSON
// request/response messages (not plain REST like Binance/OANDA) — every
// request gets a req_id, and the matching response echoes it back under
// echo_req.req_id. This wrapper hides that behind plain async functions,
// reconnecting automatically if the connection drops.
let ws = null;
let connectPromise = null;
let reqCounter = 1;
const pending = new Map(); // req_id -> { resolve, reject, timeout }

function scheduleReconnect() {
  ws = null;
  connectPromise = null;
  for (const { reject } of pending.values()) reject(new Error('Deriv connection dropped'));
  pending.clear();
}

function connect() {
  if (connectPromise) return connectPromise;
  connectPromise = new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${config.DERIV_APP_ID}`);
    let settled = false;

    socket.on('open', async () => {
      ws = socket;
      if (!config.DERIV_API_TOKEN) {
        settled = true;
        resolve(); // allow read-only calls (candles/ticks) even without a token
        return;
      }
      try {
        await sendRequest({ authorize: config.DERIV_API_TOKEN });
        settled = true;
        resolve();
      } catch (err) {
        settled = true;
        reject(err);
      }
    });

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.error) {
        const reqId = msg.echo_req && msg.echo_req.req_id;
        const entry = reqId != null ? pending.get(reqId) : null;
        if (entry) {
          clearTimeout(entry.timeout);
          pending.delete(reqId);
          entry.reject(new Error(`Deriv API error: ${msg.error.message} (${msg.error.code})`));
        }
        return;
      }
      const reqId = msg.req_id || (msg.echo_req && msg.echo_req.req_id);
      const entry = reqId != null ? pending.get(reqId) : null;
      if (entry) {
        clearTimeout(entry.timeout);
        pending.delete(reqId);
        entry.resolve(msg);
      }
    });

    socket.on('close', () => { scheduleReconnect(); });
    socket.on('error', (err) => {
      if (!settled) { settled = true; reject(err); }
      scheduleReconnect();
    });
  });
  return connectPromise;
}

async function sendRequest(payload) {
  await connect();
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    scheduleReconnect();
    await connect();
  }
  const req_id = reqCounter++;
  const body = JSON.stringify({ ...payload, req_id });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(req_id);
      reject(new Error(`Deriv request timed out: ${Object.keys(payload)[0]}`));
    }, 15000);
    pending.set(req_id, { resolve, reject, timeout });
    ws.send(body);
  });
}

// Normalizes to the same shape the other two teams' clients use:
// {time, open, high, low, close, volume}. Deriv has no real per-trade
// volume for forex/commodities (OTC, same as OANDA) — 0 is used and the
// Range Researcher's activity signal degrades gracefully (see its notes).
async function getCandles(symbol, granularitySec, count) {
  const msg = await sendRequest({
    ticks_history: symbol,
    adjust_start_time: 1,
    count,
    end: 'latest',
    granularity: granularitySec,
    style: 'candles'
  });
  return (msg.candles || []).map(c => ({
    time: c.epoch,
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: 0
  }));
}

async function getPrice(symbol) {
  const msg = await sendRequest({ ticks_history: symbol, adjust_start_time: 1, count: 1, end: 'latest', style: 'ticks' });
  const prices = msg.history && msg.history.prices;
  if (!prices || !prices.length) throw new Error(`No price returned for ${symbol}`);
  return parseFloat(prices[prices.length - 1]);
}

async function getBalance() {
  const msg = await sendRequest({ balance: 1 });
  return parseFloat(msg.balance.balance);
}

// Deriv's Multiplier contracts are the closest native-API equivalent to a
// leveraged CFD position with an attached stop-loss/take-profit — a
// "stake" (not margin/notional) times a fixed "multiplier" decides
// exposure, and limit_order.take_profit/stop_loss are MONETARY P&L amounts
// (in account currency) at which the contract auto-closes, not price
// levels. See team/portfolio.js for the price-move -> money conversion.
async function buyMultiplier({ symbol, direction, stake, multiplier, takeProfitAmount, stopLossAmount }) {
  const proposal = await sendRequest({
    proposal: 1,
    contract_type: direction === 'long' ? 'MULTUP' : 'MULTDOWN',
    symbol,
    currency: config.ACCOUNT_CURRENCY,
    amount: stake,
    basis: 'stake',
    multiplier,
    limit_order: {
      take_profit: Number(takeProfitAmount.toFixed(2)),
      stop_loss: Number(stopLossAmount.toFixed(2))
    }
  });
  const buy = await sendRequest({ buy: proposal.proposal.id, price: proposal.proposal.ask_price });
  return {
    contractId: buy.buy.contract_id,
    buyPrice: parseFloat(buy.buy.buy_price),
    entrySpot: proposal.proposal.spot != null ? parseFloat(proposal.proposal.spot) : null
  };
}

// Works even after the contract has closed — is_sold tells us it's done,
// profit/sell_price give the realized outcome.
async function getContract(contractId) {
  const msg = await sendRequest({ proposal_open_contract: 1, contract_id: contractId });
  const c = msg.proposal_open_contract;
  return {
    isSold: !!c.is_sold,
    profit: c.profit != null ? parseFloat(c.profit) : null,
    sellPrice: c.sell_price != null ? parseFloat(c.sell_price) : null,
    entrySpot: c.entry_spot != null ? parseFloat(c.entry_spot) : null
  };
}

module.exports = { getCandles, getPrice, getBalance, buyMultiplier, getContract };
