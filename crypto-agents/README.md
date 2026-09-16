# DeepSea Crypto Team (Binance)

यह एक अलग, आपके **अपने VPS/server पर चलने वाला** Node.js service है — Render पर deploy नहीं होता (Binance, Render के US datacenter IP को 451/403 से block कर देता है)। **डिफ़ॉल्ट paper trading mode mein hai** — asli paisa tabhi lagega jab aap khud `LIVE_TRADING_ENABLED=true` karenge.

## Recommended flow: pehle paper, phir live

**Abhi ke liye recommendation yehi hai**: `LIVE_TRADING_ENABLED=false` (default) rakh kar kuch din chalao, `/crypto` dashboard page ya terminal logs mein result dekho (kitni trades lin, kitni target hit hui, kitni stopped out, overall P/L), aur jab result se santusht ho tabhi `true` karke asli paisa lagao. Poori team ka decision aur reasoning paper mode mein bhi 100% real hai — bas order Binance ko nahi jaata.

## Yeh kya karta hai

1. **Scanner (real-time, WebSocket)** — poore Binance exchange ke sabhi USDT pairs ko live scan karta hai, koi fixed list nahi, koi polling delay nahi. Binance ek hi WebSocket connection par har ~1 second mein poore exchange ka ticker update push karta hai — volume surge dikhte hi turant pakड़ा jaata hai, 20 second ke poll ka wait nahi karna padta. (`WS_SCANNER_ENABLED=false` karke slower REST-polling fallback bhi available hai, sirf tab use karo agar VPS ka network WebSocket block karta ho.)
2. Jahan bhi surge milta hai, wo coin **poori team** se guzarta hai — sab kuch synchronous in-process math hai (koi LLM call nahi), isliye milliseconds mein result aata hai:
   - **Research Team (2 agents)** — Momentum Researcher (EMA/RSI se short-term bias) aur Volume Researcher (taker-buy ratio se pata karta hai real buying hai ya sirf churn).
   - **Discussion Team (2 agents)** — Bull Debater check karta hai ki dono researchers agree karte hain ya nahi; Skeptic Debater pump-and-dump jaise red flags dhoondta hai (extended move, single-candle spike, extreme volume ratio) aur trade block kar sakta hai.
   - **Portfolio Management (2 agents)** — Position Sizer conservative risk % (default 1% capital) se exact quantity nikalta hai; Exposure Guard daily loss cap, max concurrent trades, aur per-coin cooldown check karta hai. Balance ek in-memory cache se aata hai (`balanceCache.js`), har baar Binance se dobara nahi maangte — isse ek network round-trip bach jaata hai har decision mein.
   - **General Manager (1 agent)** — sabki sign-off milne par hi final BUY decision deta hai, warna hold.
3. Approve hone par **market BUY** order jaata hai, turant uske saath ek **OCO sell** (take-profit + stop-loss dono ek saath) laga di jaati hai. Yeh OCO order Binance ke apne matching engine par baithta hai — matlab exit **hamesha instant hai**, price cross hote hi, chahe yeh process kuch bhi kar raha ho us waqt. Chhota profit target (default +0.6%) ya tight stop (default -0.35%), jo pehle hit ho.
4. **Telegram par turant alert** — har BUY, har target-hit, har stopped-out apna alag message deta hai, seedha isi process se (Render ke through nahi). WhatsApp se koi connection nahi hai.
5. (Optional) Team ki live reasoning aur trade log Render dashboard ko bhi report hoti hai (`/crypto` page) — sirf dikhane ke liye, isse trading ka koi decision nahi lete.

## Speed — kaise fast rakha gaya hai

- Scanning poll nahi hai, ek live WebSocket hai — koi delay nahi, ~1 second mein poora exchange update ho jaata hai.
- Balance ke liye har trade se pehle Binance ko signed request nahi jaati — ek in-memory cache use hoti hai jo har trade ke turant baad khud update ho jaati hai, sirf occasionally (`BALANCE_RESYNC_MS`) real account se sync hoti hai fee-drift theek karne ke liye.
- Exit (take-profit/stop-loss) Binance ke apne server par OCO order ke roop mein rehta hai — yeh is process ki speed par bilkul depend nahi karta, price cross hote hi turant fill hota hai.
- Sabse zyada asar VPS ki apni network latency ka padta hai: agar possible ho to VPS Singapore/Tokyo/Hong Kong jaisi Binance ke paas wali location mein lo (jaise AWS ap-northeast-1 ya ap-southeast-1) — India ya US se latency zyada hoga.
- Ek hi cheez jo real network round-trip leti hai poori entry pipeline mein: candle data (klines) fetch aur (live mode mein) order placement khud — dono zaroori hain aur inse bacha nahi ja sakta, but baaki sab (research, discussion, sizing, decision) turant hai.

## Safety — pehle ye zaroor samjho

- **`LIVE_TRADING_ENABLED=false` default hai.** Isse `true` karne ke baad hi asli order jayenge.
- Binance API key banate waqt **withdrawal permission kabhi na dein**, sirf "Enable Spot & Margin Trading"। Key ko apne VPS ke IP address tak restrict karein — .env file leak hone par bhi paisa withdraw nahi ho payega.
- Risk defaults conservative rakhe gaye hain: per trade sirf 1% capital, +0.6% target / -0.35% stop, max 2 trades ek saath, aur din bhar mein 3% se zyada loss hote hi us din ke liye naye trades ruk jaate hain (`DAILY_LOSS_CAP_PCT`).
- Kill-switch: `.env` mein `LIVE_TRADING_ENABLED=false` karke process restart karo — turant sab naye trades band ho jayenge (jo positions already Binance par OCO order ke saath open hain, wo apne aap chalte rahenge chahe ye process band ho).
- **Yeh koi guarantee nahi hai.** Volume surge fake bhi ho sakta hai (pump-and-dump), aur crypto bahut volatile hai — chhota % risk rakhne ke bawajood paisa doobne ka real risk hamesha rehta hai. Sirf utni hi capital lagayein jitni khone ka afford kar sakte ho.

## Setup

1. Is repo ko apne VPS/server par clone karo, phir:
   ```
   cd crypto-agents
   npm install
   ```
2. `.env` banao (`.env.example` se copy karke) aur bharo:
   - `LIVE_TRADING_ENABLED=false` rehne do pehle — paper trading se shuru karo
   - `PAPER_STARTING_BALANCE` — jitni capital se real mein trade karne ka plan hai, wahi amount daal do, taki paper result us amount ke liye meaningful ho
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — Telegram par trade alerts ke liye (neeche steps hain)
   - `BINANCE_API_KEY`, `BINANCE_API_SECRET` — abhi ke liye khali bhi chhod sakte ho (paper mode ko inki zaroorat nahi), jab live karna ho tab banao (upar wali safety notes zaroor padhein)
   - `CRYPTO_BRIDGE_TOKEN` — agar Render dashboard par bhi live status dekhna hai (optional) to koi random string daalo, aur wahi value Render service ke environment variables mein `CRYPTO_BRIDGE_TOKEN` ke naam se set karo
3. Telegram bot banane ke liye:
   - Telegram par `@BotFather` ko message karo, `/newbot` bolo, jo token mile wo `TELEGRAM_BOT_TOKEN` mein daalo
   - Apne bot ko ek baar koi bhi message bhejo, phir browser mein `https://api.telegram.org/bot<TOKEN>/getUpdates` kholo — usme `chat.id` dikhega, wahi `TELEGRAM_CHAT_ID` hai
4. Chalao:
   ```
   npm start
   ```
   Terminal mein "WS scanner connected" dikhna chahiye, phir scanner ke logs, team ke decisions, aur trades.
5. **VPS par hamesha chalte rehne ke liye** (terminal band hone par bhi), [pm2](https://pm2.keymetrics.io/) use karein:
   ```
   npm install -g pm2
   pm2 start index.js --name deepsea-crypto-team
   pm2 save
   pm2 startup
   ```
   Logs dekhne ke liye: `pm2 logs deepsea-crypto-team`. Rokne ke liye: `pm2 stop deepsea-crypto-team`.

## Paper trading ke result kaise check karein

- Terminal logs mein har trade `ENTERED ...` aur `Closed ... target_hit/stopped_out pnl=...` dikhega.
- Agar `CRYPTO_BRIDGE_TOKEN` set kiya hai, Render dashboard ke `/crypto` page par jaakar dekho: total closed trades, target-hit/stopped-out split, aur cumulative realized P/L (`totalRealizedPnl`).
- Telegram par bhi har trade ka open/close message aata rahega — yehi sabse tez tarika hai real-time dekhne ka.
- Kam se kam kuch din / kaafi saari trades hone dena, tabhi win-rate aur P/L ka number meaningful hoga — 2-3 trades ke baad decide mat karo.

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
| `WS_SCANNER_ENABLED` | `false` karne par slower REST-polling fallback use hota hai (sirf agar WebSocket blocked ho) |
| `POSITION_TICK_MS` | Open positions check aur status report kitni baar ho (default 3s) — trading speed par asar nahi, sirf bookkeeping |

## Forex team abhi kahaan hai?

Forex ke liye abhi live order execution nahi banaya gaya — sirf existing dashboard pipeline (Chart Agent -> Risk Manager -> General Manager, `../trading/`) hai jo signal deti hai, Telegram alert karti hai, aur Trade Journal mein log karti hai. Asli MT5 order automatically bhejne ke liye alag se kaam karna hoga (jab decide karein to bataayein).
