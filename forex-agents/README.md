# DeepSea Forex Team (OANDA)

Yeh bhi crypto-agents/ jaisa hi ek alag Node.js service hai, apne **laptop par chalta hai**, Render par nahi. **Default paper trading mode mein hai** — asli paisa tabhi lagega jab aap khud `LIVE_TRADING_ENABLED=true` karenge.

## Yeh kya karta hai

Ek hi team-of-agents pipeline (Research -> Discussion -> Portfolio Management -> General Manager -> Executor) `INSTRUMENTS` mein diye gaye **har forex pair** par chalta hai — default: EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD, EUR/GBP, EUR/JPY, GBP/JPY, aur XAU/USD (gold). Har naye 5-minute candle band hone par har pair evaluate hota hai:

1. **Research Team (2 agents)** — Momentum Researcher (EMA/RSI se short-term bias), Range Researcher (candle apni high-low range mein kahaan close hui, uska conviction proxy — forex/gold OTC market hai isliye Binance jaisa real buy/sell volume available nahi hota).
2. **Discussion Team** — Direction Debater dono researchers ka agreement check karta hai (LONG ya SHORT dono le sakta hai), Skeptic Debater already-extended move ko red-flag karta hai, Trend Filter (EMA50 vs EMA200) counter-trend trade block karta hai.
3. **Portfolio Management** — Position Sizer conservative risk % se exact units nikalta hai (fixed low leverage ke saath), Exposure Guard daily loss cap, total exposure cap, aur per-pair cooldown check karta hai.
4. **General Manager** — sabki sign-off milne par hi final entry, warna hold.
5. Approve hone par ek **market order + saath mein hi stop-loss aur take-profit attached** (OANDA yeh dono ek hi order ke saath support karta hai) — Binance Futures jaisi do alag orders ki zaroorat nahi.
6. **Telegram par turant alert** — har entry, har target-hit, har stopped-out apna message deta hai, total capital aur total profit ke saath.

## Risk:reward aur risk policy

- Fixed **1:3 risk:reward** — stop 0.3%, target 0.9% (crypto team jaisa hi philosophy).
- Leverage kam rakha hai (default 5x) — apna khud ka stop-loss hamesha margin-call se pehle fire hota hai.
- `MAX_CONCURRENT_TRADES=0` (uncapped — jitne pair qualify karein utni trades), `MAX_TOTAL_EXPOSURE_PCT=25` real safety net hai.
- `DAILY_LOSS_CAP_PCT=3` — itna % din mein doob jaye to us din naye trades band.

## Setup

1. **OANDA practice (demo) account banao** — [oanda.com](https://oanda.com) par free signup, asli paisa nahi lagta.
2. Login karke **Personal Access Token** generate karo: My Account -> Manage API Access.
3. Apna **Account ID** dashboard par milega (jaise `101-004-XXXXXXX-001`).
4. ```
   cd forex-agents
   npm install
   ```
5. `.env.example` se `.env` banao aur bharo: `OANDA_API_TOKEN`, `OANDA_ACCOUNT_ID` (upar wale steps se), `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` (crypto-agents wale hi use kar sakte ho).
6. Chalao:
   ```
   npm start
   ```
   Terminal mein trading pairs list, phir har pair ke hold/entry decisions, aur trades dikhenge.

## Paper trading ke result kaise check karein

- Terminal logs mein har trade `ENTERED ...` aur `Closed ... target_hit/stopped_out pnl=...` dikhega.
- Telegram par har trade ka open/close message aayega, total capital aur total profit ke saath.
- Kaafi saari trades hone dena kuch din, tabhi win-rate aur P/L ka number meaningful hoga.

## Tuning (`.env` mein, code badle bina)

| Setting | Kya karta hai |
| --- | --- |
| `INSTRUMENTS` | Kaunse pairs trade karne hain (comma-separated) |
| `PER_TRADE_RISK_PCT` / `FOREX_LEVERAGE` | Har trade ka size |
| `TAKE_PROFIT_PCT` / `STOP_LOSS_PCT` | 1:3 ratio bana ke rakhna hai to dono ko saath badalna |
| `MAX_CONCURRENT_TRADES` / `MAX_TOTAL_EXPOSURE_PCT` | Ek saath kitni trades aur kitna total capital risk mein |
| `TRADE_COOLDOWN_MIN` | Ek pair mein trade ke baad dobara entry se pehle kitni der rukein |
| `CANDLE_GRANULARITY` | Candle timeframe (default M5 = 5 minute) |
