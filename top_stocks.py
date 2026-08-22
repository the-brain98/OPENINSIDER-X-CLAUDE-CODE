"""Top 20 board: today's biggest % gainers (Yahoo's day-gainers screener)
plus a fixed mega-cap watchlist priced live via Schwab.

Read-only: fetches and returns market data. Does not place any trades.
"""
import time
from concurrent.futures import ThreadPoolExecutor

import yfinance as yf

from schwab_client import get_quotes, get_price_history

# Roughly the 20 largest US-listed names by market cap. A fixed watchlist on
# purpose -- class-share tickers (BRK.B) are skipped to avoid symbol-format
# mismatches between Schwab (BRK/B) and everything else.
MEGA_CAPS = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "LLY", "JPM",
    "WMT", "V", "XOM", "UNH", "MA", "ORCL", "COST", "PG", "HD", "NFLX",
]

GAINERS_TTL = 120
HISTORY_TTL = 600  # daily candles; no need to refetch 20 histories every poll
_gainers_cache: tuple | None = None
_history_cache: tuple | None = None


def _pct(current, past):
    if not past:
        return None
    return round((current - past) / past * 100, 2)


def get_day_gainers() -> list:
    global _gainers_cache
    now = time.time()
    if _gainers_cache and now - _gainers_cache[0] < GAINERS_TTL:
        return _gainers_cache[1]

    quotes = yf.screen("day_gainers", count=20).get("quotes", [])
    out = [
        {
            "symbol": q.get("symbol"),
            "name": q.get("shortName") or q.get("longName") or "",
            "last": q.get("regularMarketPrice"),
            "changePct": round(q["regularMarketChangePercent"], 2)
            if q.get("regularMarketChangePercent") is not None
            else None,
            "volume": q.get("regularMarketVolume"),
            "marketCap": q.get("marketCap"),
        }
        for q in quotes
    ]
    _gainers_cache = (now, out)
    return out


def _fetch_history(symbol: str) -> tuple[str, list]:
    try:
        return symbol, get_price_history(symbol)
    except Exception:
        return symbol, []


def _histories() -> dict:
    global _history_cache
    now = time.time()
    if _history_cache and now - _history_cache[0] < HISTORY_TTL:
        return _history_cache[1]
    with ThreadPoolExecutor(max_workers=8) as pool:
        hist = dict(pool.map(_fetch_history, MEGA_CAPS))
    _history_cache = (now, hist)
    return hist


def get_mega_caps() -> list:
    quotes = get_quotes(MEGA_CAPS)
    hist = _histories()
    out = []
    for i, sym in enumerate(MEGA_CAPS, start=1):
        entry = quotes.get(sym, {})
        quote = entry.get("quote", {})
        last = quote.get("lastPrice")
        candles = hist.get(sym) or []
        out.append(
            {
                "rank": i,
                "symbol": sym,
                "name": entry.get("reference", {}).get("description", ""),
                "last": last,
                "change1D": round(quote.get("netPercentChange", 0), 2) if last else None,
                "change5D": _pct(last, candles[-6]["close"]) if last and len(candles) >= 6 else None,
                "change1M": _pct(last, candles[0]["close"]) if last and candles else None,
                "sparkline": [c["close"] for c in candles] + ([last] if last else []),
            }
        )
    return out


if __name__ == "__main__":
    import json

    print(json.dumps({"gainers": get_day_gainers(), "megaCaps": get_mega_caps()}, indent=2))
