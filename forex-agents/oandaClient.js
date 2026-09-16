const config = require('./config');

// OANDA v20 REST wrapper. Much simpler auth than Binance — a plain Bearer
// token, no HMAC signing — and OANDA supports attaching the take-profit AND
// stop-loss directly to the opening order itself (stopLossOnFill /
// takeProfitOnFill), so unlike Binance Futures there's no need for two
// separate conditional orders or a "which one filled first" race.
function baseUrl() {
  return config.OANDA_ENVIRONMENT === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
}

async function request(method, path, body) {
  if (!config.OANDA_API_TOKEN || !config.OANDA_ACCOUNT_ID) {
    throw new Error('OANDA_API_TOKEN / OANDA_ACCOUNT_ID not configured');
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.OANDA_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`OANDA ${path} failed: http ${res.status} ${data ? JSON.stringify(data) : ''}`);
  }
  return data;
}

// Returns only fully-closed candles, oldest first, normalized to plain
// numbers — OANDA nests OHLC as strings under `.mid`. `volume` here is a
// tick count (how many price updates happened), not financial size — OTC
// forex/CFD trading has no real shared order book, so there's no true
// "volume" the way an exchange like Binance has.
async function getCandles(instrument, granularity, count) {
  const data = await request('GET', `/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`);
  return data.candles
    .filter(c => c.complete)
    .map(c => ({
      time: c.time,
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: c.volume
    }));
}

async function getPrice(instrument) {
  const data = await request('GET', `/v3/accounts/${config.OANDA_ACCOUNT_ID}/pricing?instruments=${instrument}`);
  const p = data.prices && data.prices[0];
  if (!p) throw new Error(`No price returned for ${instrument}`);
  const bid = parseFloat(p.closeoutBid);
  const ask = parseFloat(p.closeoutAsk);
  return (bid + ask) / 2;
}

// Batched version — OANDA's pricing endpoint accepts a comma-separated
// instrument list and returns them all in one call, which is what lets
// monitoring every open position across many pairs stay a single request
// per tick instead of one per pair.
async function getPrices(instruments) {
  const data = await request('GET', `/v3/accounts/${config.OANDA_ACCOUNT_ID}/pricing?instruments=${instruments.join(',')}`);
  const out = {};
  for (const p of data.prices || []) {
    const bid = parseFloat(p.closeoutBid);
    const ask = parseFloat(p.closeoutAsk);
    out[p.instrument] = (bid + ask) / 2;
  }
  return out;
}

async function getAccountSummary() {
  const data = await request('GET', `/v3/accounts/${config.OANDA_ACCOUNT_ID}/summary`);
  return {
    balance: parseFloat(data.account.balance),
    marginAvailable: parseFloat(data.account.marginAvailable),
    marginUsed: parseFloat(data.account.marginUsed),
    nav: parseFloat(data.account.NAV)
  };
}

// Cached for the life of the process — margin requirements change rarely,
// and this is only ever used as a sanity check on sizing, never the
// primary sizing input (FOREX_LEVERAGE is).
const marginRateCache = {};
async function getMarginRate(instrument) {
  if (marginRateCache[instrument]) return marginRateCache[instrument];
  const data = await request('GET', `/v3/accounts/${config.OANDA_ACCOUNT_ID}/instruments?instruments=${instrument}`);
  const inst = data.instruments && data.instruments[0];
  const rate = inst ? parseFloat(inst.marginRate) : 0.05;
  marginRateCache[instrument] = rate;
  return rate;
}

async function placeMarketOrderWithBrackets(instrument, units, stopLossPrice, takeProfitPrice) {
  const data = await request('POST', `/v3/accounts/${config.OANDA_ACCOUNT_ID}/orders`, {
    order: {
      type: 'MARKET',
      instrument,
      units: String(units),
      timeInForce: 'FOK',
      positionFill: 'DEFAULT',
      stopLossOnFill: { price: stopLossPrice.toFixed(2) },
      takeProfitOnFill: { price: takeProfitPrice.toFixed(2) }
    }
  });
  const fill = data.orderFillTransaction;
  if (!fill) {
    throw new Error(`Order did not fill: ${JSON.stringify(data)}`);
  }
  return {
    tradeID: fill.tradeOpened ? fill.tradeOpened.tradeID : fill.id,
    avgFillPrice: parseFloat(fill.price),
    units: parseFloat(fill.units)
  };
}

// Still returns full detail after the trade has closed (state: 'CLOSED'),
// including OANDA's own realizedPL and averageClosePrice — reading these
// straight from the broker is more accurate than recomputing P&L
// ourselves, since it already accounts for spread and any financing.
async function getTrade(tradeID) {
  const data = await request('GET', `/v3/accounts/${config.OANDA_ACCOUNT_ID}/trades/${tradeID}`);
  const t = data.trade;
  return {
    state: t.state, // 'OPEN' or 'CLOSED'
    realizedPL: parseFloat(t.realizedPL || 0),
    averageClosePrice: t.averageClosePrice ? parseFloat(t.averageClosePrice) : null,
    price: parseFloat(t.price)
  };
}

module.exports = { getCandles, getPrice, getPrices, getAccountSummary, getMarginRate, placeMarketOrderWithBrackets, getTrade };
