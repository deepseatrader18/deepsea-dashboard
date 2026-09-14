import os
import time
from datetime import datetime, timezone

import pandas as pd
import requests
from fastapi import FastAPI, HTTPException

app = FastAPI(title="DeepSea Technical Analysis Service")

# Both Yahoo Finance and Stooq started serving bot-check/JS-challenge pages
# to Render's IP instead of real data — a pattern consumer-facing sites
# increasingly apply to cloud/datacenter IPs. Alpha Vantage is a real API
# built for programmatic access, so it doesn't do that, but its free tier
# is capped at 25 requests/day — everything here is built around that.
ALPHA_VANTAGE_KEY = os.environ.get("ALPHA_VANTAGE_KEY", "")
ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"

# 3 symbols, 25 requests/day total: a long cache is required, not optional.
CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours -> at most 12 calls/day across all 3 symbols
_cache = {}

FX_SYMBOLS = {
    "XAUUSD": ("XAU", "USD"),
    "EURUSD": ("EUR", "USD"),
}
CRYPTO_SYMBOLS = {
    "BTCUSD": ("BTC", "USD"),
}


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


def check_alpha_vantage_error(data: dict):
    if "Note" in data:
        raise HTTPException(status_code=429, detail=f"Alpha Vantage rate limit: {data['Note']}")
    if "Information" in data:
        raise HTTPException(status_code=429, detail=f"Alpha Vantage: {data['Information']}")
    if "Error Message" in data:
        raise HTTPException(status_code=502, detail=f"Alpha Vantage error: {data['Error Message']}")


def fetch_fx_daily(from_symbol: str, to_symbol: str) -> pd.DataFrame:
    resp = requests.get(
        ALPHA_VANTAGE_URL,
        params={
            "function": "FX_DAILY",
            "from_symbol": from_symbol,
            "to_symbol": to_symbol,
            "outputsize": "compact",
            "apikey": ALPHA_VANTAGE_KEY,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    check_alpha_vantage_error(data)

    series = data.get("Time Series FX (Daily)")
    if not series:
        raise HTTPException(status_code=502, detail=f"Unexpected Alpha Vantage response: {str(data)[:300]}")

    rows = []
    for date_str, ohlc in sorted(series.items()):
        rows.append({
            "Date": date_str,
            "Open": float(ohlc["1. open"]),
            "High": float(ohlc["2. high"]),
            "Low": float(ohlc["3. low"]),
            "Close": float(ohlc["4. close"]),
        })
    return pd.DataFrame(rows)


def fetch_crypto_daily(symbol: str, market: str) -> pd.DataFrame:
    resp = requests.get(
        ALPHA_VANTAGE_URL,
        params={
            "function": "DIGITAL_CURRENCY_DAILY",
            "symbol": symbol,
            "market": market,
            "apikey": ALPHA_VANTAGE_KEY,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    check_alpha_vantage_error(data)

    series = data.get("Time Series (Digital Currency Daily)")
    if not series:
        raise HTTPException(status_code=502, detail=f"Unexpected Alpha Vantage response: {str(data)[:300]}")

    rows = []
    for date_str, ohlc in sorted(series.items()):
        # Alpha Vantage has changed this endpoint's key naming over time;
        # accept either style rather than breaking on the next change.
        open_v = ohlc.get("1a. open (USD)") or ohlc.get("1. open")
        high_v = ohlc.get("2a. high (USD)") or ohlc.get("2. high")
        low_v = ohlc.get("3a. low (USD)") or ohlc.get("3. low")
        close_v = ohlc.get("4a. close (USD)") or ohlc.get("4. close")
        if close_v is None:
            continue
        rows.append({
            "Date": date_str,
            "Open": float(open_v),
            "High": float(high_v),
            "Low": float(low_v),
            "Close": float(close_v),
        })
    return pd.DataFrame(rows)


def fetch_daily_ohlc(symbol: str) -> pd.DataFrame:
    if symbol in FX_SYMBOLS:
        from_symbol, to_symbol = FX_SYMBOLS[symbol]
        return fetch_fx_daily(from_symbol, to_symbol)
    if symbol in CRYPTO_SYMBOLS:
        av_symbol, market = CRYPTO_SYMBOLS[symbol]
        return fetch_crypto_daily(av_symbol, market)
    raise HTTPException(status_code=400, detail=f"Unsupported symbol: {symbol}")


def get_cached_ohlc(symbol: str) -> pd.DataFrame:
    now = time.time()
    entry = _cache.get(symbol)
    if entry and now - entry["at"] < CACHE_TTL_SECONDS:
        return entry["data"]
    data = fetch_daily_ohlc(symbol)
    _cache[symbol] = {"at": now, "data": data}
    return data


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/analyze")
def analyze(symbol: str):
    symbol = symbol.upper()
    if not ALPHA_VANTAGE_KEY:
        raise HTTPException(status_code=500, detail="ALPHA_VANTAGE_KEY not configured")
    if symbol not in FX_SYMBOLS and symbol not in CRYPTO_SYMBOLS:
        raise HTTPException(status_code=400, detail=f"Unsupported symbol: {symbol}")

    try:
        data = get_cached_ohlc(symbol)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Market data fetch failed: {exc}")

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
