"""Deterministic conviction score for insider-purchase clusters.

Not a model, not AI — a documented point formula over signals that are
well-established (if imperfect) proxies for insider conviction:

  Cluster   (25 pts) — how many *distinct* insiders bought this ticker in
                        the current window. One buyer could be noise;
                        three is coordination or a shared read on the business.
  Size      (25 pts) — total $ committed, log-scaled (a $50k buy and a
                        $5M buy shouldn't count the same, but $2M vs $4M
                        shouldn't either).
  Role      (25 pts) — seniority of the buyer(s). CEO/CFO/Chair purchases
                        are the closest an outsider gets to "the person
                        with the most information about this business
                        just bought stock with their own money."
  Conviction(15 pts) — average % increase in the insider's own stake.
                        Buying 2% more of a position you already hold is
                        a smaller signal than doubling it.
  Recency   (10 pts) — decays over 14 days. A three-week-old filing is
                        already priced in by the market.

Every component is visible in the API response so the score is auditable,
not a black box.
"""
import math

import pandas as pd

ROLE_WEIGHTS = [
    (("ceo",), 1.0),
    (("cob", "chairman"), 0.9),
    (("cfo",), 0.9),
    (("pres",), 0.8),
    (("coo",), 0.75),
    (("10%",), 0.55),
    (("director",), 0.5),
    (("vp", "gc"), 0.35),
]


def _role_weight(title: str) -> float:
    t = str(title).lower()
    best = 0.25
    for keys, weight in ROLE_WEIGHTS:
        if any(k in t for k in keys):
            best = max(best, weight)
    return best


def score_clusters(df: pd.DataFrame) -> list[dict]:
    if df.empty:
        return []

    df = df.copy()
    df["role_weight"] = df["Title"].apply(_role_weight)
    now = pd.Timestamp.now()
    df["filing_dt"] = pd.to_datetime(df["Filing Date"], errors="coerce")

    groups = []
    for ticker, g in df.groupby("Ticker"):
        cluster_count = g["Insider Name"].nunique()
        buy_count = len(g)
        total_value = g["Value"].sum()
        max_role = g["role_weight"].max()
        avg_delta_own = g["DeltaOwn"].dropna().abs().mean()
        latest_filing = g["filing_dt"].max()
        days_old = (now - latest_filing).total_seconds() / 86400 if pd.notna(latest_filing) else 999
        avg_price = g["Price"].mean()

        delta_own_val = 0 if pd.isna(avg_delta_own) else avg_delta_own

        cluster_score = min(cluster_count / 3, 1) * 25
        size_score = min(math.log10(max(total_value, 1) + 1) / math.log10(2_000_000), 1) * 25
        role_score = max_role * 25
        conviction_score = min(delta_own_val / 50, 1) * 15
        recency_score = max(0, 1 - days_old / 14) * 10

        total_score = round(cluster_score + size_score + role_score + conviction_score + recency_score, 1)

        groups.append({
            "ticker": ticker,
            "company": g["Company Name"].iloc[0],
            "score": total_score,
            "breakdown": {
                "cluster": round(cluster_score, 1),
                "size": round(size_score, 1),
                "role": round(role_score, 1),
                "conviction": round(conviction_score, 1),
                "recency": round(recency_score, 1),
            },
            "clusterCount": int(cluster_count),
            "buyCount": int(buy_count),
            "totalValue": round(total_value, 2),
            "avgPrice": round(avg_price, 2),
            "avgDeltaOwnPct": round(avg_delta_own, 1) if pd.notna(avg_delta_own) else None,
            "topRole": g.loc[g["role_weight"].idxmax(), "Title"],
            "insiders": sorted(g["Insider Name"].unique().tolist()),
            "latestFiling": g["Filing Date"].max(),
        })

    return sorted(groups, key=lambda x: x["score"], reverse=True)
