import os
import time
from datetime import datetime, timezone

import pandas as pd
import requests
from fastapi import FastAPI, HTTPException

app = FastAPI(title="DeepSea Technical Analysis Service")

# Alpha Vantage's free tier caps at 25 requests/day, which real polling
# traffic exhausts within a couple of hours. Twelve Data's free tier allows
# 800 requests/day (8/min), which is enough headroom for continuous polling
# across all 3 symbols even without aggressive caching.
TWELVE_DATA_KEY = os.environ.get("TWELVE_DATA_API_KEY", "")
TWELVE_DATA_URL = "https://api.twelvedata.com/time_series"

SYMBOL_MAP = {
    "XAUUSD": "XAU/USD",
    "BTCUSD": "BTC/USD",
    "EURUSD": "EUR/USD",
}

# Cache successes for a while to stay well under the rate limit, but also
# cache failures (briefly) so a rate-limit or outage window doesn't turn
# every poll into another outbound call while we wait it out.
CACHE_TTL_SUCCESS_SECONDS = 15 * 60
CACHE_TTL_FAILURE_SECONDS = 2 * 60
_cache = {}


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def compute_rsi(close: pd.Series, period: int = 14) -> float:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return float(rsi.iloc[-1])


def window_bias(close: pd.Series, window: int) -> str:
    if len(close) < window + 1:
        return "unknown"
    change_pct = (close.iloc[-1] - close.iloc[-window]) / close.iloc[-window] * 100
    if change_pct > 0.5:
        return "up"
    if change_pct < -0.5:
        return "down"
    return "flat"


def fetch_daily_ohlc(symbol: str) -> pd.DataFrame:
    td_symbol = SYMBOL_MAP[symbol]
    resp = requests.get(
        TWELVE_DATA_URL,
        params={
            "symbol": td_symbol,
            "interval": "1day",
            "outputsize": 100,
            "apikey": TWELVE_DATA_KEY,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    if isinstance(data, dict) and data.get("status") == "error":
        code = data.get("code")
        status_code = code if isinstance(code, int) and 400 <= code < 600 else 502
        raise HTTPException(status_code=status_code, detail=f"Twelve Data error: {data.get('message', 'unknown error')}")

    values = data.get("values") if isinstance(data, dict) else None
    if not values:
        raise HTTPException(status_code=502, detail=f"Unexpected Twelve Data response: {str(data)[:300]}")

    rows = [
        {
            "Date": v["datetime"],
            "Open": float(v["open"]),
            "High": float(v["high"]),
            "Low": float(v["low"]),
            "Close": float(v["close"]),
        }
        for v in values
    ]
    return pd.DataFrame(rows).sort_values("Date").reset_index(drop=True)


def get_cached_ohlc(symbol: str) -> pd.DataFrame:
    now = time.time()
    entry = _cache.get(symbol)
    if entry:
        ttl = CACHE_TTL_SUCCESS_SECONDS if entry["ok"] else CACHE_TTL_FAILURE_SECONDS
        if now - entry["at"] < ttl:
            if entry["ok"]:
                return entry["data"]
            raise entry["error"]

    try:
        data = fetch_daily_ohlc(symbol)
    except HTTPException as exc:
        _cache[symbol] = {"at": now, "ok": False, "error": exc}
        raise
    except Exception as exc:
        wrapped = HTTPException(status_code=502, detail=f"Market data fetch failed: {exc}")
        _cache[symbol] = {"at": now, "ok": False, "error": wrapped}
        raise wrapped

    _cache[symbol] = {"at": now, "ok": True, "data": data}
    return data


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/analyze")
def analyze(symbol: str):
    symbol = symbol.upper()
    if not TWELVE_DATA_KEY:
        raise HTTPException(status_code=500, detail="TWELVE_DATA_API_KEY not configured")
    if symbol not in SYMBOL_MAP:
        raise HTTPException(status_code=400, detail=f"Unsupported symbol: {symbol}. Supported: {list(SYMBOL_MAP)}")

    data = get_cached_ohlc(symbol)

    if data.empty or "Close" not in data.columns or len(data) < 2:
        raise HTTPException(status_code=502, detail="Not enough market data returned")

    n = len(data)
    close = data["Close"]
    last_price = float(close.iloc[-1])

    sma20 = float(close.rolling(20).mean().iloc[-1]) if n >= 20 else None
    sma50 = float(close.rolling(50).mean().iloc[-1]) if n >= 50 else None
    rsi14 = compute_rsi(close) if n >= 15 else None

    ema9 = float(ema(close, 9).iloc[-1]) if n >= 9 else None
    ema50 = float(ema(close, 50).iloc[-1]) if n >= 50 else None

    macd_histogram = None
    if n >= 26:
        macd_line = ema(close, 12) - ema(close, 26)
        macd_signal_series = ema(macd_line, 9)
        macd_histogram = float((macd_line - macd_signal_series).iloc[-1])

    recent = data.tail(min(30, n))
    resistance = float(recent["High"].max())
    support = float(recent["Low"].min())
    trend = "uptrend" if sma50 is not None and last_price > sma50 else ("downtrend" if sma50 is not None else "unknown")

    return {
        "symbol": symbol,
        "price": round(last_price, 2),
        "sma20": round(sma20, 2) if sma20 is not None else None,
        "sma50": round(sma50, 2) if sma50 is not None else None,
        "ema9": round(ema9, 2) if ema9 is not None else None,
        "ema50": round(ema50, 2) if ema50 is not None else None,
        "macdHistogram": round(macd_histogram, 4) if macd_histogram is not None else None,
        "rsi14": round(rsi14, 2) if rsi14 is not None and rsi14 == rsi14 else None,  # filter NaN
        "support": round(support, 2),
        "resistance": round(resistance, 2),
        "trend": trend,
        "bias": {
            "5d": window_bias(close, 5) if n >= 6 else "unknown",
            "20d": window_bias(close, 20) if n >= 21 else "unknown",
            "50d": window_bias(close, 50) if n >= 51 else "unknown",
            "90d": window_bias(close, 90) if n >= 91 else "unknown",
        },
        "dataPoints": n,
        "asOf": datetime.now(timezone.utc).isoformat(),
    }
