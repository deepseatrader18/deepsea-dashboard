# DeepSea Deriv Team (dollar forex/gold, overseas broker)

Yeh bhi apne **laptop par chalta hai**, Render par nahi. **Default paper trading mode mein hai.**

## ZAROORI — legal risk

Deriv India ke residents ko non-INR forex/gold trade karne deta hai, lekin RBI/FEMA ke rules ke against — India se overseas broker ke through XAUUSD/EURUSD jaisi non-INR pairs trade karna FEMA violation ho sakta hai. Yeh sirf broker ka issue nahi hai, koi bhi overseas broker (Exness, OctaFX, Deriv, etc.) same category mein aata hai. Ye risk aapne khud samajh kar liya hai — is code ka kaam sirf wo decision implement karna hai, decision lena nahi.

## Ye doosri do teams se kaise alag hai

Crypto (Binance) aur Forex (OANDA) teams REST API use karte hain — Deriv ka API ek persistent **WebSocket** connection hai, alag protocol. Iska matlab:

- **Kam battle-tested** — Binance/OANDA integrations bahut standard REST patterns hain, Deriv ka WebSocket protocol kam common hai, isliye pehli baar chalane par kuch cheezein adjust karni pad sakti hain (field names, error messages) — jaisa crypto bot ke Windows batch script issues fix kiye the, waisa hi ek round debugging ka lag sakta hai.
- Trading product **Multiplier contracts** hai — traditional margin/leverage/lot ki jagah ek "stake" (dollar amount) aur "multiplier" (jaise 10x) hota hai. Take-profit/stop-loss dollar amount mein set hote hain, price level mein nahi — same 1:3 risk:reward internally isi mein convert ho jaata hai.
- Real per-trade volume available nahi hai (OTC market, OANDA jaisa hi) — Range Researcher ka activity-signal yahan hamesha neutral rahega, sirf price-range wala signal kaam karega.

## Setup

1. **Deriv par free account banao** — [deriv.com](https://deriv.com), demo account apne aap ban jaata hai virtual USD balance ke saath.
2. Login karke **API token** banao: Settings -> API token -> naya token, "Read", "Trade", "Trading information" scopes ke saath.
3. ```
   cd deriv-agents
   npm install
   ```
4. `.env.example` se `.env` banao: `DERIV_API_TOKEN` (upar wale step se), `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` (crypto-agents wale hi use kar sakte ho). `DERIV_APP_ID` default (1089) rehne do.
5. Chalao:
   ```
   npm start
   ```

## Agar error aaye

Deriv API ka pehla real run kuch cheezein reveal karega jo maine bina live test kiye assume ki hain (jaise exact field names ya multiplier values jo aapke account ke liye allowed hain). Terminal mein jo bhi error aaye uska screenshot/text bhej dena, saath mil kar fix kar denge — bilkul jaisa crypto bot ke saath kiya tha.

## Tuning (`.env` mein)

| Setting | Kya karta hai |
| --- | --- |
| `INSTRUMENTS` | Kaunse pairs (Deriv ke `frx` naming mein) |
| `MULTIPLIER` | Leverage-jaisa hi — Deriv sirf specific values accept karta hai per instrument |
| `PER_TRADE_RISK_PCT` | Har trade mein kitna % free balance stake karna hai |
| `TAKE_PROFIT_PCT` / `STOP_LOSS_PCT` | 1:3 ratio, saath badalna |
| `MAX_CONCURRENT_TRADES` / `MAX_TOTAL_EXPOSURE_PCT` | Ek saath kitni trades aur kitna total risk |
