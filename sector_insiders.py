"""Cross-reference the Rotation Tracker's ETFs with recent insider buys.

For a given ETF from rotation_screener.UNIVERSE, returns insider *purchases*
filed on openinsider.com in the last day whose company belongs to that ETF's
sector (or industry, for the thematic ETFs). Ticker->sector comes from
yfinance and is cached on disk since it almost never changes.

Read-only: fetches and returns candidates. Does not place any trades.
"""
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import yfinance as yf

from insider_screener import fetch_purchases_under

# How each rotation-tracker ETF maps onto yfinance's sector/industry taxonomy.
# ("sector", name) matches info["sector"] exactly; ("industry", substring)
# matches info["industry"] case-insensitively. None = broad market: every
# last-day buy matches.
ETF_MATCHERS = {
    "SPY": None, "QQQ": None, "IWM": None,
    "XLK": ("sector", "Technology"),
    "XLF": ("sector", "Financial Services"),
    "XLE": ("sector", "Energy"),
    "XLV": ("sector", "Healthcare"),
    "XLI": ("sector", "Industrials"),
    "XLY": ("sector", "Consumer Cyclical"),
    "XLP": ("sector", "Consumer Defensive"),
    "XLB": ("sector", "Basic Materials"),
    "XLRE": ("sector", "Real Estate"),
    "XLU": ("sector", "Utilities"),
    "XLC": ("sector", "Communication Services"),
    "SMH": ("industry", "Semiconductor"),
    "KRE": ("industry", "Banks - Regional"),
    "XBI": ("industry", "Biotech"),
}

CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sector_cache.json")
BUYS_TTL = 300  # openinsider's last-day list barely moves intraday; don't re-scrape per click
MAX_ROWS = 50

_lock = threading.Lock()
_sector_cache: dict | None = None  # ticker -> {"sector": ..., "industry": ...}
_failed: set = set()  # lookups that failed this process; don't retry on every click
_buys_cache: tuple | None = None  # (fetched_at, DataFrame)


def _load_cache() -> dict:
    global _sector_cache
    if _sector_cache is None:
        try:
            with open(CACHE_PATH) as f:
                _sector_cache = json.load(f)
        except (OSError, ValueError):
            _sector_cache = {}
    return _sector_cache


def _lookup(ticker: str) -> tuple[str, str | None, str | None]:
    try:
        info = yf.Ticker(ticker).info
        return ticker, info.get("sector"), info.get("industry")
    except Exception:
        return ticker, None, None


def _resolve_sectors(tickers) -> dict:
    cache = _load_cache()
    missing = sorted({t for t in tickers if t not in cache and t not in _failed})
    if missing:
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(_lookup, missing))
        with _lock:
            for t, sector, industry in results:
                if sector or industry:
                    cache[t] = {"sector": sector, "industry": industry}
                else:
                    _failed.add(t)  # ETF, foreign listing, or transient yfinance error
            try:
                with open(CACHE_PATH, "w") as f:
                    json.dump(cache, f, indent=0, sort_keys=True)
            except OSError:
                pass
    return cache


def _recent_buys() -> pd.DataFrame:
    global _buys_cache
    now = time.time()
    if _buys_cache and now - _buys_cache[0] < BUYS_TTL:
        return _buys_cache[1]
    df = fetch_purchases_under(9999.0, max_rows=1000, filing_days=1)
    _buys_cache = (now, df)
    return df


def _clean(v):
    return None if pd.isna(v) else v


def get_sector_insider_buys(etf: str) -> dict:
    if etf not in ETF_MATCHERS:
        raise ValueError(f"Unknown rotation ETF {etf!r}")
    matcher = ETF_MATCHERS[etf]

    rows = _recent_buys().to_dict(orient="records")
    sectors = _resolve_sectors([r["Ticker"] for r in rows]) if matcher else {}

    out = []
    for r in rows:
        meta = sectors.get(r["Ticker"], {})
        if matcher:
            field, want = matcher
            have = meta.get(field) or ""
            if field == "sector" and have != want:
                continue
            if field == "industry" and want.lower() not in have.lower():
                continue
        out.append(
            {
                "filingDate": _clean(r["Filing Date"]),
                "tradeDate": _clean(r["Trade Date"]),
                "ticker": r["Ticker"],
                "company": _clean(r["Company Name"]),
                "insider": _clean(r["Insider Name"]),
                "title": _clean(r["Title"]),
                "price": _clean(r["Price"]),
                "qty": _clean(r["Qty"]),
                "value": _clean(r["Value"]),
                "industry": meta.get("industry"),
            }
        )
        if len(out) >= MAX_ROWS:
            break
    return {"etf": etf, "marketWide": matcher is None, "buys": out}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("etf", nargs="?", default="XLV")
    args = parser.parse_args()
    result = get_sector_insider_buys(args.etf.upper())
    print(json.dumps(result, indent=2))
