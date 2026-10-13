# DeepSea · TradingView trades → Telegram (free)

Yeh ek chhota browser script (agent) hai jo aapke **laptop ke Chrome me khule TradingView chart** par chalta hai. Strategy jaise hi chart par naya trade print karti hai (entry ya exit), yeh turant Telegram par message bhejta hai. Saath me Windows desktop notification bhi aata hai.

- TradingView **free plan** par kaam karta hai — alert, webhook ya paid plan ki zaroorat nahi.
- Strategy ka source code nahi chahiye — yeh sirf Strategy Tester ki "List of trades" padhta hai.
- Render / Deep Sea server ki zaroorat nahi — seedha aapke browser se Telegram jata hai.

## Setup (ek baar)

1. Chrome me **Tampermonkey** extension install kariye: https://www.tampermonkey.net/
2. Chrome me `chrome://extensions` kholiye → upar right **Developer mode** ON kariye (Tampermonkey ke naye version ke liye zaroori hai).
3. Tampermonkey icon → **Create a new script** → jo bhi likha hai sab delete kariye → `deepsea-tv-telegram.user.js` ka poora code paste kariye → **File → Save** (Ctrl+S).
4. TradingView chart kholiye. Script ek baar **Telegram BOT TOKEN** aur **CHAT ID** poochhega — wahi daaliye jo Render par `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` me hain.
5. Test: Tampermonkey icon → **Test message bhejo** → Telegram par "✅ DeepSea TradingView agent chal raha hai." aana chahiye.

## Har baar chart par

1. Chart par apni strategy lagi honi chahiye.
2. Neeche **Strategy Tester** panel kholiye → **List of trades** tab chuniye.
3. **Trade #** column header par click karke list ko ulta (naya trade sabse upar) kar dijiye — lambi list me TradingView neeche wale trades load nahi karta.
4. Chart wala tab **khula aur dikhta hua** rakhiye — alag window me rakh sakte hain. Tab minimize/background me hone par Chrome use dheema kar deta hai aur trade late pakda ja sakta hai.

## Dhyan dein

- Laptop band / sleep ya Chrome band = koi notification nahi. Jab tak chart khula hai tabhi tak kaam karta hai.
- Symbol, timeframe ya strategy settings badalne par poori list nayi banti hai — tab message nahi jata (yeh jaan-boojh kar hai).
- Settings badalni ho to Tampermonkey icon → **Telegram settings badlo**.
- Kuch kaam na kare to chart par F12 → Console me `[DeepSea]` wali lines dekhiye.
