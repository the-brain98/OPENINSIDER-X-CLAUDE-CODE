"""Screen openinsider.com for insider *purchases* under a price cap.

Read-only: fetches and prints candidates. Does not place any trades.
"""
import argparse
import io

import pandas as pd
import requests

URL = "http://openinsider.com/screener"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; insider-screener/1.0)"}


def fetch_purchases_under(
    max_price: float,
    max_rows: int = 1000,
    min_qty: int = 0,
    titles: list[str] | None = None,
    ticker: str | None = None,
    filing_days: int | None = None,
) -> pd.DataFrame:
    params = {
        "xp": 1,  # transaction type: P - Purchase only
        "ph": max_price,  # price high
        "cnt": max_rows,
        "sortcol": 0,  # sort by Filing Date
    }
    if ticker:
        params["s"] = ticker.upper()
    if filing_days:
        params["fd"] = filing_days  # filing date within the last N days (site accepts 1/7/30/365)
    # bounded wait: when openinsider is down, callers (the dashboard dropdowns)
    # should get an error in seconds, not hang on the OS's ~75s connect timeout
    resp = requests.get(URL, headers=HEADERS, params=params, timeout=15)
    resp.raise_for_status()

    out_cols = [
        "Filing Date",
        "Trade Date",
        "Ticker",
        "Company Name",
        "Insider Name",
        "Title",
        "Price",
        "Qty",
        "Value",
        "DeltaOwn",
    ]

    # Pick the filings table by its columns, not by size: with few results (e.g.
    # a single-ticker query) the filings table is *smaller* than the page's nav
    # tables, and with zero results it isn't on the page at all.
    tables = pd.read_html(io.StringIO(resp.text))
    df = None
    for t in tables:
        cols = [str(c).replace("\xa0", " ") for c in t.columns]  # site uses NBSPs
        if "Ticker" in cols and "Qty" in cols:
            df = t
            df.columns = cols
            break
    if df is None:
        return pd.DataFrame(columns=out_cols)
    if "Company Name" not in df.columns:  # single-ticker view omits the company column
        df["Company Name"] = ""

    df["Qty"] = df["Qty"].astype(str).str.replace(r"[+,]", "", regex=True).astype(int)
    df["Price"] = df["Price"].astype(str).str.replace(r"[$,]", "", regex=True).astype(float)
    df["Value"] = (
        df["Value"].astype(str).str.replace(r"[+$,]", "", regex=True).astype(float)
    )
    df["DeltaOwn"] = pd.to_numeric(
        df["ΔOwn"].astype(str).str.replace(r"[+%]", "", regex=True), errors="coerce"
    )
    df = df[df["Qty"] >= min_qty]

    if titles:
        pattern = "|".join(titles)
        df = df[df["Title"].astype(str).str.contains(pattern, case=False, na=False)]

    return df[out_cols].sort_values("Filing Date", ascending=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-price", type=float, default=20.0)
    parser.add_argument("--rows", type=int, default=1000)
    parser.add_argument("--min-qty", type=int, default=0, help="minimum shares purchased")
    parser.add_argument(
        "--titles",
        type=str,
        default="CEO",
        help="comma-separated substrings to match against Title, e.g. 'CEO,Pres,CFO'. Empty string = no filter.",
    )
    args = parser.parse_args()

    title_list = [t.strip() for t in args.titles.split(",") if t.strip()] or None

    results = fetch_purchases_under(
        args.max_price, args.rows, min_qty=args.min_qty, titles=title_list
    )
    if results.empty:
        print("No matching insider purchases found.")
    else:
        print(results.to_string(index=False))
