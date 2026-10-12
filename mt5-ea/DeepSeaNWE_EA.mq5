//+------------------------------------------------------------------+
//|                                              DeepSeaNWE_EA.mq5   |
//|  Expert Advisor built on the Nadaraya-Watson endpoint estimator  |
//|                                                                  |
//|  Signal logic ported from "Nadaraya-Watson Smoothers [LuxAlgo]"  |
//|  (c) LuxAlgo, licensed CC BY-NC-SA 4.0                            |
//|  https://creativecommons.org/licenses/by-nc-sa/4.0/              |
//|  => this derived work is also CC BY-NC-SA 4.0 (non-commercial).   |
//|                                                                  |
//|  Only the NON-repainting endpoint mode is used. The repainting   |
//|  mode looks into the future and cannot be traded.                 |
//+------------------------------------------------------------------+
#property copyright "DeepSea - derived from LuxAlgo (CC BY-NC-SA 4.0)"
#property version   "1.00"

#include <Trade\Trade.mqh>

//--- NWE settings
input group "Nadaraya-Watson"
input double             InpBandwidth    = 8.0;          // Bandwidth (h)
input int                InpWindow       = 500;          // Kernel window (bars)
input ENUM_APPLIED_PRICE InpPrice        = PRICE_CLOSE;  // Source
input double             InpMinSlopePts  = 0.0;          // Min slope to confirm flip (points)

//--- Risk / exits
input group "Risk"
input double InpRiskPercent   = 1.0;    // Risk per trade, % of equity (0 = fixed lots)
input double InpFixedLots     = 0.01;   // Fixed lots (used when risk % = 0)
input int    InpAtrPeriod     = 14;     // ATR period
input double InpSlAtrMult     = 1.5;    // Stop loss = ATR x
input double InpTpAtrMult     = 3.0;    // Take profit = ATR x (0 = none)
input double InpTrailAtrMult  = 0.0;    // ATR trailing stop x (0 = off)
input bool   InpCloseOnFlip   = true;   // Close position on opposite signal

//--- Filters
input group "Filters"
input bool   InpAllowBuy      = true;   // Allow buys
input bool   InpAllowSell     = true;   // Allow sells
input int    InpMaxSpreadPts  = 50;     // Max spread (points, 0 = off)
input int    InpStartHour     = 0;      // Trading start hour (server time)
input int    InpEndHour       = 24;     // Trading end hour (server time)

//--- General
input group "General"
input ulong  InpMagic         = 18082026; // Magic number
input bool   InpDrawArrows    = true;     // Draw signal arrows on chart

CTrade   trade;
double   g_weights[];
double   g_den = 0.0;
int      g_atrHandle = INVALID_HANDLE;
datetime g_lastBar = 0;

//+------------------------------------------------------------------+
//| Gaussian window, same as the Pine gauss(x, h)                     |
//+------------------------------------------------------------------+
double Gauss(const double x, const double h)
{
   return MathExp(-(x * x) / (h * h * 2.0));
}

//+------------------------------------------------------------------+
double PriceOf(const MqlRates &r)
{
   switch(InpPrice)
   {
      case PRICE_OPEN:     return r.open;
      case PRICE_HIGH:     return r.high;
      case PRICE_LOW:      return r.low;
      case PRICE_MEDIAN:   return (r.high + r.low) / 2.0;
      case PRICE_TYPICAL:  return (r.high + r.low + r.close) / 3.0;
      case PRICE_WEIGHTED: return (r.high + r.low + 2.0 * r.close) / 4.0;
      default:             return r.close;
   }
}

//+------------------------------------------------------------------+
//| Endpoint estimator at a given shift (rates is series-indexed)     |
//+------------------------------------------------------------------+
double NweAt(const MqlRates &rates[], const int shift)
{
   double sum = 0.0;
   for(int i = 0; i < InpWindow; i++)
      sum += PriceOf(rates[shift + i]) * g_weights[i];
   return sum / g_den;
}

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpBandwidth <= 0.0 || InpWindow < 2)
   {
      Print("Bandwidth must be > 0 and window >= 2");
      return INIT_PARAMETERS_INCORRECT;
   }

   ArrayResize(g_weights, InpWindow);
   g_den = 0.0;
   for(int i = 0; i < InpWindow; i++)
   {
      g_weights[i] = Gauss(i, InpBandwidth);
      g_den += g_weights[i];
   }

   g_atrHandle = iATR(_Symbol, _Period, InpAtrPeriod);
   if(g_atrHandle == INVALID_HANDLE)
   {
      Print("Failed to create ATR handle: ", GetLastError());
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetDeviationInPoints(20);
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(g_atrHandle != INVALID_HANDLE)
      IndicatorRelease(g_atrHandle);
}

//+------------------------------------------------------------------+
//| Returns POSITION_TYPE of our open position, or -1 if none         |
//+------------------------------------------------------------------+
int OurPositionType(ulong &ticket)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      ticket = t;
      return (int)PositionGetInteger(POSITION_TYPE);
   }
   ticket = 0;
   return -1;
}

//+------------------------------------------------------------------+
double LotsForRisk(const double slDistance)
{
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double stepLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   double lots = InpFixedLots;
   if(InpRiskPercent > 0.0 && slDistance > 0.0)
   {
      double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(tickValue > 0.0 && tickSize > 0.0)
      {
         double lossPerLot = slDistance / tickSize * tickValue;
         lots = AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPercent / 100.0 / lossPerLot;
      }
   }

   if(stepLot > 0.0)
      lots = MathFloor(lots / stepLot) * stepLot;
   lots = MathMax(minLot, MathMin(maxLot, lots));
   return NormalizeDouble(lots, 2);
}

//+------------------------------------------------------------------+
bool InSession()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(InpStartHour <= InpEndHour)
      return dt.hour >= InpStartHour && dt.hour < InpEndHour;
   return dt.hour >= InpStartHour || dt.hour < InpEndHour; // overnight session
}

//+------------------------------------------------------------------+
bool SpreadOk()
{
   if(InpMaxSpreadPts <= 0) return true;
   return SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) <= InpMaxSpreadPts;
}

//+------------------------------------------------------------------+
void DrawArrow(const bool isBuy, const datetime t, const double price)
{
   if(!InpDrawArrows) return;
   string name = StringFormat("NWE_%s_%I64d", isBuy ? "B" : "S", (long)t);
   if(ObjectCreate(0, name, isBuy ? OBJ_ARROW_UP : OBJ_ARROW_DOWN, 0, t, price))
   {
      ObjectSetInteger(0, name, OBJPROP_COLOR, isBuy ? clrTeal : clrRed);
      ObjectSetInteger(0, name, OBJPROP_ANCHOR, isBuy ? ANCHOR_TOP : ANCHOR_BOTTOM);
      ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
   }
}

//+------------------------------------------------------------------+
void OpenTrade(const bool isBuy, const double atr)
{
   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * point;

   double slDist = MathMax(atr * InpSlAtrMult, minStop);
   double tpDist = InpTpAtrMult > 0.0 ? MathMax(atr * InpTpAtrMult, minStop) : 0.0;

   double price = isBuy ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                        : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double sl = isBuy ? price - slDist : price + slDist;
   double tp = tpDist > 0.0 ? (isBuy ? price + tpDist : price - tpDist) : 0.0;
   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);

   double lots = LotsForRisk(slDist);
   bool ok = isBuy ? trade.Buy(lots, _Symbol, 0.0, sl, tp, "NWE buy")
                   : trade.Sell(lots, _Symbol, 0.0, sl, tp, "NWE sell");
   if(!ok)
      PrintFormat("Order failed: %u %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
}

//+------------------------------------------------------------------+
void TrailStop(const double atr)
{
   if(InpTrailAtrMult <= 0.0) return;

   ulong ticket;
   int type = OurPositionType(ticket);
   if(type < 0 || !PositionSelectByTicket(ticket)) return;

   int    digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double curSl  = PositionGetDouble(POSITION_SL);
   double curTp  = PositionGetDouble(POSITION_TP);
   double dist   = atr * InpTrailAtrMult;

   if(type == POSITION_TYPE_BUY)
   {
      double newSl = NormalizeDouble(SymbolInfoDouble(_Symbol, SYMBOL_BID) - dist, digits);
      if(newSl > curSl + point)
         trade.PositionModify(ticket, newSl, curTp);
   }
   else
   {
      double newSl = NormalizeDouble(SymbolInfoDouble(_Symbol, SYMBOL_ASK) + dist, digits);
      if(curSl == 0.0 || newSl < curSl - point)
         trade.PositionModify(ticket, newSl, curTp);
   }
}

//+------------------------------------------------------------------+
void OnTick()
{
   // Work only once per new bar, on closed bars -> no repainting.
   datetime barTime = iTime(_Symbol, _Period, 0);
   if(barTime == 0 || barTime == g_lastBar) return;

   int need = InpWindow + 3;
   if(Bars(_Symbol, _Period) < need) return;

   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   if(CopyRates(_Symbol, _Period, 0, need, rates) < need) return;

   double atrBuf[];
   ArraySetAsSeries(atrBuf, true);
   if(CopyBuffer(g_atrHandle, 0, 1, 1, atrBuf) < 1) return;
   double atr = atrBuf[0];

   g_lastBar = barTime;

   // NWE on the last three closed bars (shift 1 = most recent closed bar)
   double n1 = NweAt(rates, 1);
   double n2 = NweAt(rates, 2);
   double n3 = NweAt(rates, 3);

   double slopeNow  = n1 - n2;
   double slopePrev = n2 - n3;
   double minSlope  = InpMinSlopePts * SymbolInfoDouble(_Symbol, SYMBOL_POINT);

   // Same colour rule as the indicator: rising = up (teal), falling = down (red).
   bool buySignal  = slopeNow >  minSlope && slopePrev <= 0.0;
   bool sellSignal = slopeNow < -minSlope && slopePrev >= 0.0;

   if(buySignal)  DrawArrow(true,  rates[1].time, rates[1].low);
   if(sellSignal) DrawArrow(false, rates[1].time, rates[1].high);

   TrailStop(atr);

   ulong ticket;
   int posType = OurPositionType(ticket);

   // Exit on opposite flip
   if(InpCloseOnFlip && posType >= 0)
   {
      if((posType == POSITION_TYPE_BUY && sellSignal) ||
         (posType == POSITION_TYPE_SELL && buySignal))
      {
         if(trade.PositionClose(ticket))
            posType = -1;
      }
   }

   if(posType >= 0) return;             // one position at a time
   if(!InSession() || !SpreadOk()) return;

   if(buySignal && InpAllowBuy)
      OpenTrade(true, atr);
   else if(sellSignal && InpAllowSell)
      OpenTrade(false, atr);
}
//+------------------------------------------------------------------+
