const WebSocket = require('ws');
const EventEmitter = require('events');
const { evaluateTicker } = require('./scanner');

const STREAM_URL = 'wss://stream.binance.com:9443/ws/!miniTicker@arr';
const RECONNECT_DELAY_MS = 2000;

// Real-time replacement for polling ticker/24hr every N seconds. Binance
// pushes a mini-ticker update for every symbol on the exchange roughly
// once a second over this single WebSocket connection — so a volume
// surge is seen within about a second of happening, not after waiting out
// a REST poll interval, and it costs zero REST rate-limit weight no
// matter how many symbols exist. This is what "scanning must be fast"
// concretely means here: event-driven detection instead of polling.
class WsScanner extends EventEmitter {
  constructor() {
    super();
    this.latestPrices = {};
    this.connected = false;
    this._connect();
  }

  _connect() {
    this.ws = new WebSocket(STREAM_URL);

    this.ws.on('open', () => {
      this.connected = true;
      console.log('WS scanner connected — real-time volume scanning is live.');
    });

    this.ws.on('message', (raw) => {
      let arr;
      try {
        arr = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(arr)) return;

      for (const m of arr) {
        // miniTicker fields: s=symbol, o=open(24h ago), c=close(last), q=quote volume(24h)
        const symbol = m.s;
        const lastPrice = parseFloat(m.c);
        const openPrice = parseFloat(m.o);
        const quoteVolume = parseFloat(m.q);
        if (!symbol || !Number.isFinite(lastPrice)) continue;

        this.latestPrices[symbol] = lastPrice;

        const priceChangePct = openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : 0;
        const surge = evaluateTicker(symbol, quoteVolume, lastPrice, priceChangePct);
        if (surge) this.emit('surge', surge);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      console.error(`WS scanner disconnected — reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
      setTimeout(() => this._connect(), RECONNECT_DELAY_MS);
    });

    this.ws.on('error', (err) => {
      console.error('WS scanner error:', err.message);
    });
  }

  getLatestPrices() {
    return this.latestPrices;
  }
}

module.exports = WsScanner;
