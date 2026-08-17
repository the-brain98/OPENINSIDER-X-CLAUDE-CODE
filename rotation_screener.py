"""Sector Rotation Tracker: broad-beta + sector/thematic ETFs -- the vehicles
institutions actually rotate money into -- ranked and categorized on a 10-day
cycle. Live price/volume from Schwab; 10-day high, RSI14, and average volume
from yfinance history. Read-only: never places trades.

Categories (a read on institutional positioning, not investment advice):
  Pullback    (green)  -- strong rank + healthy pullback + RSI not overbought/oversold: best long setups
  Extended    (yellow) -- leading but stretched: near its 10-day high or RSI overbought
  Fade        (red)    -- weak rank + overbought or near highs: potential short-term short
  Consolidate (gray)   -- everything else: sideways, low conviction

The exact numeric cutoffs below (rank thirds, RSI 70/30, pullback bands) are
inferred defaults matching the qualitative rules this was modeled on -- tune
the constants at the top of this file if the real thresholds differ.
"""
import time

import numpy as np
import pandas as pd
import yfinance as yf

from schwab_client import get_quotes

# Highest-volume, most institutionally-relevant vehicles: broad market beta +
# the 11 SPDR sector ETFs + a few high-volume thematic/sector-adjacent names.
UNIVERSE = {
    "SPY": "S&P 500", "QQQ": "Nasdaq 100", "IWM": "Russell 2000",
    "XLK": "Technology", "XLF": "Financials", "XLE": "Energy",
    "XLV": "Health Care", "XLI": "Industrials", "XLY": "Consumer Discretionary",
    "XLP": "Consumer Staples", "XLB": "Materials", "XLRE": "Real Estate",
    "XLU": "Utilities", "XLC": "Communication Services",
    "SMH": "Semiconductors", "KRE": "Regional Banks", "XBI": "Biotech",
}

RANK_TOP_FRACTION = 1 / 3     # "strong rank" = top third of the universe
RANK_BOTTOM_FRACTION = 1 / 3  # "weak rank" = bottom third
RSI_OVERBOUGHT = 70           # standard technical-analysis convention, not a guess
RSI_OVERSOLD = 30             # same
NEAR_HIGH_PCT = -2.0          # within 2% of the 10-day high counts as "near highs"
HEALTHY_PULLBACK_MIN = -10.0  # a "healthy" pullback sits between these two...
HEALTHY_PULLBACK_MAX = -2.0   # ...i.e. pulled back, but not broken down

CACHE_TTL = 60  # short -- price/volume are live Schwab quotes, not delayed data
_cache: dict = {}


def _rsi(series, period=14):
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _fetch_history(tickers, days=60):
    raw = yf.download(tickers, period=f"{days}d", group_by="ticker", auto_adjust=True, progress=False, threads=True)
    if isinstance(raw.columns, pd.MultiIndex):
        present = [t for t in tickers if t in raw.columns.get_level_values(0)]
        closes = pd.DataFrame({t: raw[t]["Close"] for t in present})
        highs = pd.DataFrame({t: raw[t]["High"] for t in present})
        volumes = pd.DataFrame({t: raw[t]["Volume"] for t in present})
    else:
        closes = raw[["Close"]].rename(columns={"Close": tickers[0]})
        highs = raw[["High"]].rename(columns={"High": tickers[0]})
        volumes = raw[["Volume"]].rename(columns={"Volume": tickers[0]})
    closes = closes.dropna(how="all", axis=1).dropna(how="all", axis=0)
    highs = highs[closes.columns]
    volumes = volumes[closes.columns]
    # Yahoo occasionally has an isolated one-day gap for a single ticker (not a
    # real trading halt, just a missing data point) -- forward-fill it rather
    # than letting one NaN propagate through every rolling window that touches
    # it and silently drop that ticker from the whole table.
    closes = closes.ffill()
    highs = highs.ffill()
    volumes = volumes.ffill()
    return closes, highs, volumes


def _categorize(rank, n, pct_from_high, rsi):
    top_cut = max(1, round(n * RANK_TOP_FRACTION))
    bottom_cut = n - max(1, round(n * RANK_BOTTOM_FRACTION))
    strong = rank <= top_cut
    weak = rank > bottom_cut
    near_high = pct_from_high > NEAR_HIGH_PCT
    overbought = rsi >= RSI_OVERBOUGHT
    oversold = rsi <= RSI_OVERSOLD
    healthy_pullback = HEALTHY_PULLBACK_MIN <= pct_from_high <= HEALTHY_PULLBACK_MAX

    if strong and healthy_pullback and not overbought and not oversold:
        return "Pullback"
    if strong and (near_high or overbought):
        return "Extended"
    if weak and (overbought or near_high):
        return "Fade"
    return "Consolidate"


def get_sector_rotation_table(force_refresh: bool = False) -> pd.DataFrame:
    cache_key = "sector_rotation"
    now = time.time()
    cached = _cache.get(cache_key)
    if not force_refresh and cached and now - cached[0] < CACHE_TTL:
        return cached[1]

    tickers = list(UNIVERSE.keys())
    closes, highs, volumes = _fetch_history(tickers)
    quotes = get_quotes(tickers)

    rows = []
    for t in closes.columns:
        quote = quotes.get(t, {}).get("quote", {})
        last = quote.get("lastPrice")
        today_vol = quote.get("totalVolume")
        if last is None:
            continue

        high_10 = highs[t].rolling(10).max().iloc[-1]
        pct_from_high = (last / high_10 - 1) * 100 if high_10 else None

        rsi14 = _rsi(closes[t]).iloc[-1]
        ret_10 = closes[t].pct_change(10).iloc[-1]
        avg_vol_10 = volumes[t].rolling(10).mean().iloc[-1]
        rel_vol = today_vol / avg_vol_10 if today_vol and avg_vol_10 else None

        rows.append(
            {
                "Ticker": t,
                "Sector": UNIVERSE[t],
                "Last": round(last, 2),
                "10d %": round(ret_10 * 100, 2) if pd.notna(ret_10) else None,
                "% from 10d High": round(pct_from_high, 2) if pct_from_high is not None else None,
                "RSI14": round(rsi14, 1) if pd.notna(rsi14) else None,
                "Rel Vol (10d)": round(rel_vol, 2) if rel_vol is not None else None,
            }
        )

    df = pd.DataFrame(rows).dropna(subset=["10d %", "% from 10d High", "RSI14"])
    df["Rank"] = df["10d %"].rank(ascending=False).astype(int)
    n = len(df)
    df["Status"] = [_categorize(r["Rank"], n, r["% from 10d High"], r["RSI14"]) for _, r in df.iterrows()]
    df = df.sort_values("Rank")

    _cache[cache_key] = (now, df)
    return df


if __name__ == "__main__":
    print(get_sector_rotation_table().to_string())
