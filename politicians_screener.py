"""Read congressional stock trades out of the local Quantgress-derived DuckDB
(see politicians/) and attach party affiliation via party_lookup.py.

Read-only: this module never scrapes or writes -- that's politicians/refresh.py.
"""
import os
import time

import duckdb

import party_lookup

DB_PATH = os.path.join(os.path.dirname(__file__), "politicians", "congress_trades.duckdb")

CACHE_TTL = 600  # the underlying DB only changes when someone runs politicians/refresh.py
_cache: tuple[float, list[dict]] | None = None


def _amount_display(low, high):
    if low is None:
        return "Unknown"
    if high is None:
        return f"${low:,}+"
    return f"${low:,} - ${high:,}"


def _chamber_label(chamber):
    return "Senate" if chamber == "S" else "House"


def is_configured() -> bool:
    return os.path.exists(DB_PATH)


def _load_all() -> list[dict]:
    con = duckdb.connect(DB_PATH, read_only=True)
    try:
        rows = con.execute(
            """SELECT chamber, first_name, last_name, office, tkr, asset_name,
                      tx_type, amount_low, amount_high,
                      CAST(txn_date AS VARCHAR) AS txn_date,
                      CAST(filed_date AS VARCHAR) AS filed_date,
                      lag_days
               FROM trades
               ORDER BY filed_date DESC NULLS LAST"""
        ).fetchall()
        cols = [d[0] for d in con.description]
    finally:
        con.close()

    out = []
    for row in rows:
        r = dict(zip(cols, row))
        party_full, party_short = party_lookup.lookup_party(
            r["first_name"], r["last_name"], r["chamber"], r["office"], r["txn_date"]
        )
        out.append(
            {
                "Name": f"{r['first_name']} {r['last_name']}".strip(),
                "Chamber": _chamber_label(r["chamber"]),
                "Party": party_full,
                "PartyShort": party_short,
                "Ticker": r["tkr"],
                "Company": r["asset_name"],
                "Type": r["tx_type"],
                "AmountLow": r["amount_low"],
                "AmountHigh": r["amount_high"],
                "Amount": _amount_display(r["amount_low"], r["amount_high"]),
                "TxnDate": r["txn_date"],
                "FiledDate": r["filed_date"],
                "LagDays": r["lag_days"],
            }
        )
    return out


def get_trades(
    ticker: str | None = None,
    chamber: str | None = None,
    party: str | None = None,
    limit: int = 300,
    force_refresh: bool = False,
) -> list[dict]:
    global _cache
    now = time.time()
    if force_refresh or _cache is None or now - _cache[0] > CACHE_TTL:
        _cache = (now, _load_all())

    rows = _cache[1]
    if ticker:
        t = ticker.strip().upper()
        rows = [r for r in rows if r["Ticker"] == t]
    if chamber:
        rows = [r for r in rows if r["Chamber"].lower() == chamber.strip().lower()]
    if party:
        p = party.strip().lower()
        rows = [r for r in rows if r["PartyShort"].lower() == p or r["Party"].lower() == p]

    return rows[:limit]


if __name__ == "__main__":
    for t in get_trades(limit=10):
        print(t)
