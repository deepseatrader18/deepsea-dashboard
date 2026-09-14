import io
from datetime import datetime, timezone

import pandas as pd
import requests
from fastapi import FastAPI, HTTPException

app = FastAPI(title="DeepSea Technical Analysis Service")

# Yahoo Finance (yfinance) actively blocks requests from cloud/datacenter IPs
# like Render's, so we use Stooq's free, keyless CSV endpoint instead — it
# has no such restriction and needs no API key.
SYMBOL_MAP = {
    "XAUUSD": "xauusd",
    "BTCUSD": "btcusd",
    "EURUSD": "eurusd",
}

STOOQ_URL = "https://stooq.com/q/d/l/?s={symbol}&i=d"


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
    stooq_symbol = SYMBOL_MAP.get(symbol)
    if not stooq_symbol:
        raise HTTPException(status_code=400, detail=f"Unsupported symbol: {symbol}. Supported: {list(SYMBOL_MAP)}")

    try:
        resp = requests.get(
            STOOQ_URL.format(symbol=stooq_symbol),
            headers={"User-Agent": "Mozilla/5.0 (compatible; DeepSeaDashboard/1.0)"},
            timeout=10,
        )
        resp.raise_for_status()
        if "No data" in resp.text[:20]:
            raise HTTPException(status_code=502, detail=f"Stooq has no data for {symbol}")
        data = pd.read_csv(io.StringIO(resp.text))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Market data fetch failed: {exc}")

    if data.empty or len(data) < 20 or "Close" not in data.columns:
        raise HTTPException(status_code=502, detail="Not enough market data returned")

    close = data["Close"]
    last_price = float(close.iloc[-1])
    sma20 = float(close.rolling(20).mean().iloc[-1])
    sma50 = float(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else None
    rsi14 = compute_rsi(close)

    recent = data.tail(30)
    resistance = float(recent["High"].max())
    support = float(recent["Low"].min())
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
