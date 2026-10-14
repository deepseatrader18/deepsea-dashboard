# DeepSea · TradingView trades → Telegram (free)

Yeh ek chhota browser script (agent) hai jo aapke **laptop ke Chrome me khule TradingView chart** par chalta hai. Strategy jaise hi chart par naya trade print karti hai (entry ya exit), yeh turant Telegram par message bhejta hai. Saath me Windows desktop notification bhi aata hai.

- TradingView **free plan** par kaam karta hai — alert, webhook ya paid plan ki zaroorat nahi.
- Strategy ka source code nahi chahiye — yeh sirf Strategy Tester ki "List of trades" padhta hai.
- Render / Deep Sea server ki zaroorat nahi — seedha aapke browser se Telegram jata hai.

## Setup (ek baar)

1. Chrome me **Tampermonkey** extension install kariye: https://www.tampermonkey.net/
2. Chrome me `chrome://extensions` kholiye → upar right **Developer mode** ON kariye (Tampermonkey ke naye version ke liye zaroori hai).
3. Usi Chrome me Deep Sea dashboard par login kariye, phir yeh link kholiye: **https://deepsea-dashboard.onrender.com/tv-agent.user.js** → Tampermonkey ka page khulega → **Install** dabaiye.
   Telegram Bot Token / Chat ID dashboard khud bhar deta hai — kuch type nahi karna.
4. Test: Tampermonkey icon → **Test message bhejo** → Telegram par "✅ DeepSea TradingView agent chal raha hai." aana chahiye.

(Manual tareeka: Tampermonkey → Create a new script → `deepsea-tv-telegram.user.js` ka code paste → Save. Is tareeke me pehli baar chart kholne par Bot Token aur Chat ID poochha jayega.)

## Har baar chart par

1. Chart par apni strategy lagi honi chahiye.
2. Neeche **Strategy Tester** panel kholiye → **List of trades** tab chuniye.
3. **Trade #** column header par click karke list ko ulta (naya trade sabse upar) kar dijiye — lambi list me TradingView neeche wale trades load nahi karta.
4. Chart wala tab **khula aur dikhta hua** rakhiye — alag window me rakh sakte hain. Tab minimize/background me hone par Chrome use dheema kar deta hai aur trade late pakda ja sakta hai.

## Entry / SL / TP message

Naye trade par message chart ke label jaisa aata hai:

```
🟢 BUY ENTRY · XAUUSD

Entry : 4157.205
SL    : 4148.891
TP1   : 4161.362
TP2   : 4165.519
TP3   : 4169.677
```

Strategy ke labels (Entry/SL/TP box) chart ki tasveer me bante hain, script unhe padh nahi sakta — isliye SL/TP entry price se hisaab lagaye jaate hain: **SL = entry ± 0.2%, TP1/TP2/TP3 = 0.5R / 1R / 1.5R** (XAUUSD par "Confirmed candle + S&D + BT&SP" strategy ke labels se milaya). Strategy ki settings alag hon to Tampermonkey icon → **SL / TP settings badlo** se badliye (SL % = 0 karne par SL/TP nahi bheje jaate). Message me SL/TP ko ek baar chart ke label se mila lijiye.

## Dhyan dein

- Laptop band / sleep ya Chrome band = koi notification nahi. Jab tak chart khula hai tabhi tak kaam karta hai.
- Symbol, timeframe ya strategy settings badalne par poori list nayi banti hai — tab message nahi jata (yeh jaan-boojh kar hai).
- Settings badalni ho to Tampermonkey icon → **Telegram settings badlo**.
- Kuch kaam na kare to chart par F12 → Console me `[DeepSea]` wali lines dekhiye.
