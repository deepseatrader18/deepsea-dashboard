# DeepSea Crypto Team (Binance, live trading)

यह एक अलग, आपके **अपने VPS/server पर चलने वाला** Node.js service है — Render पर deploy नहीं होता (Binance, Render के US datacenter IP को 451/403 से block कर देता है), और यह असली पैसों से असली ऑर्डर Binance पर रख सकता है। **इसे समझे बिना live मत करें।**

## यह क्या करता है

1. **Scanner** — पूरे Binance exchange के सारे USDT pairs (कोई fixed list नहीं) को हर ~20 सेकंड में scan करता है, हर coin के अपने recent average volume के मुकाबले sudden volume surge ढूंढता है।
2. जहाँ भी surge मिलता है, वो coin **पूरी टीम** से गुज़रता है:
   - **Research Team (2 agents)** — Momentum Researcher (EMA/RSI se short-term bias) aur Volume Researcher (taker-buy ratio se pata karta hai real buying hai ya sirf churn)।
   - **Discussion Team (2 agents)** — Bull Debater check karta hai ki dono researchers agree karte hain ya nahi; Skeptic Debater pump-and-dump jaise red flags dhoondta hai (extended move, single-candle spike, extreme volume ratio) aur trade block kar sakta hai.
   - **Portfolio Management (2 agents)** — Position Sizer conservative risk % (default 1% capital) se exact quantity nikalta hai, exchange ke minimum-order rules ke hisaab se; Exposure Guard daily loss cap, max concurrent trades, aur per-coin cooldown check karta hai.
   - **General Manager (1 agent)** — sabki sign-off milne par hi final BUY decision deta hai, warna hold.
3. Approve hone par **market BUY** order jaata hai, turant uske saath ek **OCO sell** (take-profit + stop-loss dono ek saath) laga di jaati hai — chhota profit target (default +0.6%) ya tight stop (default -0.35%), jo pehle hit ho. Yehi "chhota profit lekar bahar" wala pattern hai.
4. Har trade (open + closed) aur team ki live reasoning Render dashboard ko report hoti hai (agar `WHATSAPP_BRIDGE_TOKEN`/`DASHBOARD_URL` set ho) — Crypto Trading Room page par dikhta hai.

## Safety — pehle ye zaroor samjho

- **`LIVE_TRADING_ENABLED=false` default hai.** Isse `true` karne ke baad hi asli order jayenge — tab tak sab kuch "paper mode" mein chalta hai (poori team ka decision + reasoning real hai, bas order Binance ko nahi jaata).
- Binance API key banate waqt **withdrawal permission kabhi na dein**, sirf "Enable Spot & Margin Trading"। Key ko apne VPS ke IP address tak restrict karein (Binance API Management mein hi option hai) — .env file leak hone par bhi paisa withdraw nahi ho payega.
- Risk defaults conservative rakhe gaye hain: per trade sirf 1% capital, +0.6% target / -0.35% stop, max 2 trades ek saath, aur din bhar mein 3% se zyada loss hote hi us din ke liye naye trades ruk jaate hain (`DAILY_LOSS_CAP_PCT`).
- Kill-switch: `.env` mein `LIVE_TRADING_ENABLED=false` karke process restart karo — turant sab naye trades band ho jayenge (jo positions already Binance par OCO order ke saath open hain, wo apne aap chalte rahenge chahe ye process band ho, kyunki OCO order Binance ke apne server par baitha hota hai).
- **Yeh koi guarantee nahi hai.** Volume surge fake bhi ho sakta hai (pump-and-dump), aur crypto bahut volatile hai — chhota % risk rakhne ke bawajood paisa doobne ka real risk hamesha rehta hai. Sirf utni hi capital lagayein jitni khone ka afford kar sakte ho.

## Setup

1. Is repo ko apne VPS/server par clone karo, phir:
   ```
   cd crypto-agents
   npm install
   ```
2. `.env` banao (`.env.example` se copy karke) aur bharo:
   - `BINANCE_API_KEY`, `BINANCE_API_SECRET` — apni Binance API key (upar wali safety notes zaroor padhein)
   - `LIVE_TRADING_ENABLED` — pehle `false` rakh kar test karein ki scanner/team sahi kaam kar rahi hai (logs dekh kar), phir `true` karein jab confident ho
   - `WHATSAPP_BRIDGE_TOKEN` — agar Render dashboard par live status dekhna hai to wahi value daalo jo Render service par bhi set hai (`WHATSAPP_BRIDGE_TOKEN`)
3. Chalao:
   ```
   npm start
   ```
   Terminal mein scanner ke logs, team ke decisions, aur trades dikhenge.
4. **VPS par hamesha chalte rehne ke liye** (terminal band hone par bhi), [pm2](https://pm2.keymetrics.io/) use karein:
   ```
   npm install -g pm2
   pm2 start index.js --name deepsea-crypto-team
   pm2 save
   pm2 startup
   ```
   Logs dekhne ke liye: `pm2 logs deepsea-crypto-team`. Rokne ke liye: `pm2 stop deepsea-crypto-team`.

## Tuning (`.env` mein, code badle bina)

| Setting | Kya karta hai |
| --- | --- |
| `PER_TRADE_RISK_PCT` | Har trade mein kitna % free balance lagayein (default 1%) |
| `TAKE_PROFIT_PCT` / `STOP_LOSS_PCT` | Scalp exit targets (default +0.6% / -0.35%) |
| `MAX_CONCURRENT_TRADES` | Ek saath max kitne open positions (default 2) |
| `DAILY_LOSS_CAP_PCT` | Itna % din mein doob jaye to us din naye trades band (default 3%) |
| `SYMBOL_COOLDOWN_MIN` | Ek coin mein trade ke baad dobara entry se pehle kitni der rukein (default 15 min) |
| `VOLUME_SURGE_MULTIPLIER` | Baseline se kitna guna volume aane par surge maana jaye (default 3x) |
| `MIN_QUOTE_VOLUME_24H` | Itne se kam 24h volume wale illiquid coins ignore honge (default $2M) |

## Forex team abhi kahaan hai?

Forex ke liye abhi live order execution nahi banaya gaya — sirf existing dashboard pipeline (Chart Agent -> Risk Manager -> General Manager, `../trading/`) hai jo signal deti hai, Telegram alert karti hai, aur Trade Journal mein log karti hai. Asli MT5 order automatically bhejne ke liye alag se kaam karna hoga (jab decide karein to bataayein).
