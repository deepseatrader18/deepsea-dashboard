const crypto = require('crypto');
const config = require('./config');

// Thin Binance Spot REST wrapper. Deliberately minimal — only the endpoints
// this bot actually needs (public market data, account balance, market
// order, OCO exit order) — not a general-purpose SDK.
//
// This must run somewhere with real access to api.binance.com (Binance
// returns 451/403 to US-hosted datacenter IPs, which is why this lives in
// crypto-agents/ to run on the owner's own VPS, not on Render).

let exchangeInfoCache = null; // symbol -> { stepSize, tickSize, minNotional, quoteAsset, baseAsset }
let serverTimeOffsetMs = 0;

function sign(queryString) {
  return crypto.createHmac('sha256', config.BINANCE_API_SECRET).update(queryString).digest('hex');
}

async function publicRequest(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${config.BINANCE_BASE_URL}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Binance ${path} failed: http ${res.status} ${data ? JSON.stringify(data) : ''}`);
  }
  return data;
}

async function signedRequest(method, path, params = {}) {
  if (!config.BINANCE_API_KEY || !config.BINANCE_API_SECRET) {
    throw new Error('BINANCE_API_KEY / BINANCE_API_SECRET not configured');
  }
  const timestamp = Date.now() + serverTimeOffsetMs;
  const fullParams = { ...params, timestamp, recvWindow: 10000 };
  const qs = new URLSearchParams(fullParams).toString();
  const signature = sign(qs);
  const url = `${config.BINANCE_BASE_URL}${path}?${qs}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': config.BINANCE_API_KEY },
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Binance ${path} failed: http ${res.status} ${data ? JSON.stringify(data) : ''}`);
  }
  return data;
}

async function syncServerTime() {
  const data = await publicRequest('/api/v3/time');
  serverTimeOffsetMs = data.serverTime - Date.now();
}

// exchangeInfo carries every symbol's LOT_SIZE/PRICE_FILTER/MIN_NOTIONAL
// filters — Binance rejects an order whose quantity/price doesn't line up
// exactly with these, so every order this bot places must be rounded
// through the helpers below first.
async function loadExchangeInfo() {
  const data = await publicRequest('/api/v3/exchangeInfo');
  const map = {};
  for (const s of data.symbols) {
    if (s.status !== 'TRADING' || !s.isSpotTradingAllowed) continue;
    const lotSize = s.filters.find(f => f.filterType === 'LOT_SIZE');
    const priceFilter = s.filters.find(f => f.filterType === 'PRICE_FILTER');
    const notional = s.filters.find(f => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL');
    map[s.symbol] = {
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      stepSize: lotSize ? parseFloat(lotSize.stepSize) : null,
      minQty: lotSize ? parseFloat(lotSize.minQty) : null,
      tickSize: priceFilter ? parseFloat(priceFilter.tickSize) : null,
      minNotional: notional ? parseFloat(notional.minNotional ?? notional.notional) : 0
    };
  }
  exchangeInfoCache = map;
  return map;
}

function getSymbolFilters(symbol) {
  if (!exchangeInfoCache) throw new Error('exchangeInfo not loaded yet — call loadExchangeInfo() first');
  return exchangeInfoCache[symbol] || null;
}

function roundStep(value, step) {
  if (!step) return value;
  const precision = Math.max(0, Math.round(-Math.log10(step)));
  const rounded = Math.floor(value / step) * step;
  return Number(rounded.toFixed(precision));
}

async function getAllTickers24hr() {
  return publicRequest('/api/v3/ticker/24hr');
}

async function getKlines(symbol, interval = '1m', limit = 60) {
  return publicRequest('/api/v3/klines', { symbol, interval, limit });
}

async function getAccountBalances() {
  const data = await signedRequest('GET', '/api/v3/account');
  return data.balances || [];
}

async function getFreeBalance(asset) {
  const balances = await getAccountBalances();
  const row = balances.find(b => b.asset === asset);
  return row ? parseFloat(row.free) : 0;
}

async function placeMarketBuy(symbol, quoteOrderQty) {
  return signedRequest('POST', '/api/v3/order', {
    symbol,
    side: 'BUY',
    type: 'MARKET',
    quoteOrderQty
  });
}

// OCO (One-Cancels-the-Other) sell: a limit sell at the take-profit price
// and a stop-limit sell at the stop-loss price, whichever fills first
// cancels the other — this is what makes the "get in, take a small
// profit, get out" pattern hands-off instead of needing constant polling.
async function placeOcoSell(symbol, quantity, takeProfitPrice, stopPrice, stopLimitPrice) {
  return signedRequest('POST', '/api/v3/order/oco', {
    symbol,
    side: 'SELL',
    quantity,
    price: takeProfitPrice,
    stopPrice,
    stopLimitPrice,
    stopLimitTimeInForce: 'GTC'
  });
}

async function getOrder(symbol, orderId) {
  return signedRequest('GET', '/api/v3/order', { symbol, orderId });
}

async function getOpenOrders(symbol) {
  return signedRequest('GET', '/api/v3/openOrders', symbol ? { symbol } : {});
}

module.exports = {
  syncServerTime,
  loadExchangeInfo,
  getSymbolFilters,
  roundStep,
  getAllTickers24hr,
  getKlines,
  getAccountBalances,
  getFreeBalance,
  placeMarketBuy,
  placeOcoSell,
  getOrder,
  getOpenOrders
};
