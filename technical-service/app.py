import os
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException

app = FastAPI(title="DeepSea Technical Analysis Service")

SYMBOL_MAP = {
    "XAUUSD": "GC=F",
    "BTCUSD": "BTC-USD",
    "EURUSD": "EURUSD=X",
}


def compute_rsi(close: pd.Series, period: int = 14) -> float:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return float(rsi.iloc[-1])


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/analyze")
def analyze(symbol: str):
    symbol = symbol.upper()
    ticker = SYMBOL_MAP.get(symbol)
    if not ticker:
        raise HTTPException(status_code=400, detail=f"Unsupported symbol: {symbol}. Supported: {list(SYMBOL_MAP)}")

    try:
        data = yf.download(ticker, period="3mo", interval="1d", progress=False, auto_adjust=True)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Market data fetch failed: {exc}")

    if data.empty or len(data) < 20:
        raise HTTPException(status_code=502, detail="Not enough market data returned")

    close = data["Close"]
    if hasattr(close, "columns"):  # yfinance sometimes returns a DataFrame for a single ticker
        close = close.iloc[:, 0]

    last_price = float(close.iloc[-1])
    sma20 = float(close.rolling(20).mean().iloc[-1])
    sma50 = float(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else None
    rsi14 = compute_rsi(close)

    recent = data.tail(30)
    high_col = recent["High"]
    low_col = recent["Low"]
    if hasattr(high_col, "columns"):
        high_col = high_col.iloc[:, 0]
    if hasattr(low_col, "columns"):
        low_col = low_col.iloc[:, 0]

    resistance = float(high_col.max())
    support = float(low_col.min())
    trend = "uptrend" if sma50 is not None and last_price > sma50 else ("downtrend" if sma50 is not None else "unknown")

    return {
        "symbol": symbol,
        "price": round(last_price, 2),
        "sma20": round(sma20, 2) if sma20 is not None else None,
        "sma50": round(sma50, 2) if sma50 is not None else None,
        "rsi14": round(rsi14, 2) if rsi14 == rsi14 else None,  # filter NaN
        "support": round(support, 2),
        "resistance": round(resistance, 2),
        "trend": trend,
        "asOf": datetime.now(timezone.utc).isoformat(),
    }
