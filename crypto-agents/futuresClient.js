const crypto = require('crypto');
const config = require('./config');

// Binance USDT-M Futures REST wrapper — mirrors binanceClient.js's shape
// but talks to fapi.binance.com, which is what actually allows opening a
// SHORT (sell first, buy back later): plain Spot can only ever sell what
// it already owns. Kept as a separate client rather than merged into
// binanceClient.js since almost every endpoint path, response shape, and
// order-type set genuinely differs between Spot and Futures.
let exchangeInfoCache = null; // symbol -> { stepSize, tickSize, minNotional }
let serverTimeOffsetMs = 0;
const leverageSetFor = new Set(); // symbols we've already called setLeverage for this run

function sign(queryString) {
  return crypto.createHmac('sha256', config.BINANCE_API_SECRET).update(queryString).digest('hex');
}

async function publicRequest(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${config.FUTURES_BASE_URL}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Futures ${path} failed: http ${res.status} ${data ? JSON.stringify(data) : ''}`);
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
  const url = `${config.FUTURES_BASE_URL}${path}?${qs}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': config.BINANCE_API_KEY },
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Futures ${path} failed: http ${res.status} ${data ? JSON.stringify(data) : ''}`);
  }
  return data;
}

async function syncServerTime() {
  const data = await publicRequest('/fapi/v1/time');
  serverTimeOffsetMs = data.serverTime - Date.now();
}

async function loadExchangeInfo() {
  const data = await publicRequest('/fapi/v1/exchangeInfo');
  const map = {};
  for (const s of data.symbols) {
    if (s.status !== 'TRADING' || s.contractType !== 'PERPETUAL' || s.quoteAsset !== config.QUOTE_ASSET) continue;
    const lotSize = s.filters.find(f => f.filterType === 'LOT_SIZE');
    const priceFilter = s.filters.find(f => f.filterType === 'PRICE_FILTER');
    const notional = s.filters.find(f => f.filterType === 'MIN_NOTIONAL');
    map[s.symbol] = {
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      stepSize: lotSize ? parseFloat(lotSize.stepSize) : null,
      minQty: lotSize ? parseFloat(lotSize.minQty) : null,
      tickSize: priceFilter ? parseFloat(priceFilter.tickSize) : null,
      minNotional: notional ? parseFloat(notional.notional) : 0
    };
  }
  exchangeInfoCache = map;
  return map;
}

// Whether this symbol even has a USDT-M perpetual — many small-cap coins
// that surge on Spot simply aren't listed on Futures at all, so this is
// the first gate every surge has to clear before a short becomes possible.
function hasSymbol(symbol) {
  return !!(exchangeInfoCache && exchangeInfoCache[symbol]);
}

function getSymbolFilters(symbol) {
  if (!exchangeInfoCache) throw new Error('Futures exchangeInfo not loaded yet — call loadExchangeInfo() first');
  return exchangeInfoCache[symbol] || null;
}

function roundStep(value, step) {
  if (!step) return value;
  const precision = Math.max(0, Math.round(-Math.log10(step)));
  const rounded = Math.floor(value / step) * step;
  return Number(rounded.toFixed(precision));
}

async function getKlines(symbol, interval = '1m', limit = 60) {
  return publicRequest('/fapi/v1/klines', { symbol, interval, limit });
}

async function getPrice(symbol) {
  const data = await publicRequest('/fapi/v1/ticker/price', { symbol });
  return parseFloat(data.price);
}

// USDT-M futures wallet balance (this account's collateral for margin),
// separate from the Spot wallet balanceCache.js reads.
async function getFreeBalance() {
  const data = await signedRequest('GET', '/fapi/v2/balance');
  const row = data.find(b => b.asset === config.QUOTE_ASSET);
  return row ? parseFloat(row.availableBalance) : 0;
}

// Fixed, low leverage per the account owner's explicit choice — called
// once per symbol per run (Binance remembers it after that), never
// something a trade itself can widen.
async function ensureLeverage(symbol) {
  if (leverageSetFor.has(symbol)) return;
  await signedRequest('POST', '/fapi/v1/leverage', { symbol, leverage: config.FUTURES_LEVERAGE });
  leverageSetFor.add(symbol);
}

async function placeMarketOrder(symbol, side, quantity, reduceOnly = false) {
  return signedRequest('POST', '/fapi/v1/order', {
    symbol,
    side, // 'BUY' or 'SELL'
    type: 'MARKET',
    quantity,
    ...(reduceOnly ? { reduceOnly: 'true' } : {})
  });
}

// Futures has no single OCO order the way Spot does — a stop-loss and a
// take-profit are placed as two separate reduce-only conditional orders,
// and whichever fills first has to be detected so the other can be
// cancelled (see monitor.js). closePosition=true means "close the whole
// open position on trigger" rather than a fixed quantity, which is what
// keeps this correct even if the position size were ever adjusted.
async function placeStopMarket(symbol, side, stopPrice) {
  return signedRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'STOP_MARKET',
    stopPrice,
    closePosition: 'true'
  });
}

async function placeTakeProfitMarket(symbol, side, stopPrice) {
  return signedRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'TAKE_PROFIT_MARKET',
    stopPrice,
    closePosition: 'true'
  });
}

async function getOrder(symbol, orderId) {
  return signedRequest('GET', '/fapi/v1/order', { symbol, orderId });
}

async function cancelOrder(symbol, orderId) {
  return signedRequest('DELETE', '/fapi/v1/order', { symbol, orderId });
}

module.exports = {
  syncServerTime,
  loadExchangeInfo,
  hasSymbol,
  getSymbolFilters,
  roundStep,
  getKlines,
  getPrice,
  getFreeBalance,
  ensureLeverage,
  placeMarketOrder,
  placeStopMarket,
  placeTakeProfitMarket,
  getOrder,
  cancelOrder
};
