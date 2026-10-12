# DeepSea NWE EA (MT5)

`DeepSeaNWE_EA.mq5` is an MT5 Expert Advisor built on the **Nadaraya-Watson
endpoint estimator** from LuxAlgo's "Nadaraya-Watson Smoothers" indicator
(CC BY-NC-SA 4.0, non-commercial use only).

## Strategy
- Each bar gets a Gaussian kernel weight `exp(-i² / 2h²)`, summed over the
  last `Window` bars and normalized. This is the indicator's non-repainting
  endpoint mode.
- The EA calculates once per new bar, on **closed bars only**.
- **Buy** when the NWE line flips from falling to rising. **Sell** when it
  flips from rising to falling.
- SL / TP are ATR multiples. Optional ATR trailing stop, optional close on the
  opposite signal. Only one position per symbol and magic number.
- Lot size comes from the risk % of equity and the SL distance. Set risk % to
  0 to use fixed lots.
- Filters: spread limit, trading hours (server time), buy/sell on/off.

The indicator's repainting mode uses future bars, so it isn't used here.

## Install
1. MT5 → File → Open Data Folder → `MQL5/Experts/`, then copy `DeepSeaNWE_EA.mq5` there.
2. In MetaEditor, open it and press **Compile** (F7).
3. Drag it onto a chart and enable **Algo Trading**.
4. Backtest in Strategy Tester first, then a demo account, before going live.
