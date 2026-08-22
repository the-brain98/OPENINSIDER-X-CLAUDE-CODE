"""Bull/bear/PM debate chatbot for a ticker, backed by the Anthropic API.

Cost control: a ticker's debate (bull take + bear take + PM verdict, 3 calls)
is built once and cached in memory for the day. Every later question on that
same ticker reuses the cached debate and costs a single small follow-up call
instead of rebuilding the whole thing.
"""
import os
import re
import time

import anthropic

from insider_screener import fetch_purchases_under
from news import get_headlines
from quant_score import score_clusters
from schwab_client import get_price_history, get_quotes

FAST_MODEL = "claude-haiku-4-5-20251001"  # bull/bear takes, follow-up answers
PM_MODEL = "claude-sonnet-5"  # PM synthesis -- the one call worth a better model

CACHE_TTL = 24 * 60 * 60  # one trading day; click "New debate" to force a rebuild

_client: anthropic.Anthropic | None = None
_cache: dict[str, dict] = {}  # ticker -> {"builtAt": ts, "context": str, "bull": str, "bear": str, "pm": str}


def is_configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def _pct(current: float, past: float) -> float | None:
    if not past:
        return None
    return round((current - past) / past * 100, 2)


def _gather_context(ticker: str) -> str:
    lines = [f"Ticker: {ticker}"]

    try:
        quote = get_quotes([ticker])[ticker]["quote"]
        lines.append(
            f"Live quote: last price ${quote['lastPrice']:.2f}, "
            f"day change {quote.get('netPercentChange', 0):+.2f}%"
        )
    except Exception:
        lines.append("Live quote: unavailable")

    try:
        candles = get_price_history(ticker)
        if candles:
            last = candles[-1]["close"]
            change5d = _pct(last, candles[-6]["close"]) if len(candles) >= 6 else None
            change1m = _pct(last, candles[0]["close"])
            lines.append(
                f"5-day price change: {change5d:+.2f}%" if change5d is not None else "5-day price change: unavailable"
            )
            lines.append(
                f"1-month price change: {change1m:+.2f}%" if change1m is not None else "1-month price change: unavailable"
            )
    except Exception:
        lines.append("Price history: unavailable")

    try:
        df = fetch_purchases_under(max_price=999999, max_rows=25, ticker=ticker)
    except Exception:
        df = None

    if df is not None and not df.empty:
        lines.append("Recent insider purchases (openinsider.com, purchases only):")
        for _, r in df.head(5).iterrows():
            delta = f", stake +{r['DeltaOwn']:.1f}%" if pd_notna(r.get("DeltaOwn")) else ""
            lines.append(
                f"  - {r['Filing Date']}: {r['Insider Name']} ({r['Title']}) bought "
                f"{int(r['Qty']):,} sh @ ${r['Price']:.2f} (${r['Value']:,.0f}){delta}"
            )
        try:
            ranked = score_clusters(df)
            if ranked:
                r = ranked[0]
                b = r["breakdown"]
                lines.append(
                    f"This dashboard's own conviction score for {ticker}: {r['score']}/100. "
                    "This is the dashboard's documented, deterministic point formula over the insider "
                    "purchases above (quant_score.py) -- NOT an AI or third-party rating. Breakdown: "
                    f"cluster size {b['cluster']}/25 ({r['clusterCount']} distinct insiders), "
                    f"dollars committed {b['size']}/25 (${r['totalValue']:,.0f} total across {r['buyCount']} buys), "
                    f"insider seniority {b['role']}/25 (top role: {r['topRole']}), "
                    f"stake increase {b['conviction']}/15"
                    + (f" (avg +{r['avgDeltaOwnPct']}% own-stake increase)" if r["avgDeltaOwnPct"] is not None else "")
                    + f", recency {b['recency']}/10 (latest filing {r['latestFiling']}). "
                    "The score on the dashboard card may differ slightly if the user has different "
                    "screener filters applied there."
                )
        except Exception:
            pass
    else:
        lines.append("Recent insider purchases: none found in openinsider.com filings")

    try:
        headlines = get_headlines(f"{ticker} stock", limit=5)
        if headlines:
            lines.append("Recent headlines:")
            for h in headlines:
                lines.append(f"  - {h['title']} ({h['source']})")
    except Exception:
        lines.append("Recent headlines: unavailable")

    return "\n".join(lines)


def pd_notna(v) -> bool:
    return v is not None and v == v  # NaN != NaN


def _complete(model: str, system: str, user: str, max_tokens: int) -> str:
    resp = _get_client().messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(block.text for block in resp.content if block.type == "text").strip()


PLAIN_TEXT_RULE = (
    "Output plain text only, rendered verbatim in a chat bubble -- no markdown "
    "(no #, no **bold**, no headers). Bullet lines may start with a plain '-'."
)


def _bull_take(ticker: str, context: str) -> str:
    return _complete(
        FAST_MODEL,
        "You are a bull equity research analyst. Given only the factual data provided, "
        "write the strongest honest bull case in 3-5 short bullet points. Cite the actual "
        "numbers given. Do not invent data that isn't there, and do not add disclaimers. "
        + PLAIN_TEXT_RULE,
        f"{context}\n\nWrite the bull case for {ticker}.",
        300,
    )


def _bear_take(ticker: str, context: str) -> str:
    return _complete(
        FAST_MODEL,
        "You are a bear equity research analyst. Given only the factual data provided, "
        "write the strongest honest bear case in 3-5 short bullet points. Cite the actual "
        "numbers given. Do not invent data that isn't there, and do not add disclaimers. "
        + PLAIN_TEXT_RULE,
        f"{context}\n\nWrite the bear case for {ticker}.",
        300,
    )


def _pm_verdict(ticker: str, context: str, bull: str, bear: str, question: str) -> str:
    # max_tokens must clear the requested length with room to spare: at 450 the
    # verdict regularly truncated mid-sentence, losing the WINNER line and
    # silently registering every such debate as a draw.
    return _complete(
        PM_MODEL,
        "You are a portfolio manager moderating a debate between a bull and a bear analyst. "
        "The reader is a beginner investor: use plain language, and when a trading term is "
        "unavoidable, explain it in a few words. Weigh both sides against the underlying data, "
        "directly answer the user's question, and name one specific catalyst or price level "
        "that would change your read. Commit to whichever analyst argued the stronger case for "
        "right now -- declare a draw only when the evidence is genuinely balanced, never as a "
        "hedge. End with one line making clear this is a structured framework, not personalized "
        "financial advice. 220 words max. " + PLAIN_TEXT_RULE + " Then, after the disclaimer, "
        "the very last line must be exactly 'WINNER: BULL', 'WINNER: BEAR', or 'WINNER: DRAW'.",
        f"{context}\n\nBULL CASE:\n{bull}\n\nBEAR CASE:\n{bear}\n\n"
        f"User's question about {ticker}: \"{question}\"",
        700,
    )


def _follow_up(ticker: str, debate: dict, question: str) -> str:
    return _complete(
        FAST_MODEL,
        "You are continuing an equity bull/bear/PM debate that already ran earlier today. "
        "Answer the follow-up question directly and concisely using that debate, without "
        "repeating it wholesale. If the question needs data the debate doesn't have, say so "
        "rather than guessing. End with a one-line reminder this isn't personalized financial "
        "advice. 120 words max. " + PLAIN_TEXT_RULE,
        f"EARLIER DEBATE ON {ticker}:\nBULL:\n{debate['bull']}\n\nBEAR:\n{debate['bear']}\n\n"
        f"PM VERDICT:\n{debate['pm']}\n\nFollow-up question: \"{question}\"",
        250,
    )


def _split_winner(pm_text: str) -> tuple[str, str]:
    """Pull the machine-readable 'WINNER: BULL/BEAR/DRAW' line off the PM verdict.
    The prompt asks for it as the last line, but models sometimes put the
    disclaimer after it -- accept the line anywhere in the text (last occurrence
    wins) rather than mislabeling the debate a draw over ordering."""
    s = pm_text.strip()
    matches = list(re.finditer(r"^\s*WINNER:\s*(BULL|BEAR|DRAW)\b.*$", s, re.IGNORECASE | re.MULTILINE))
    if not matches:
        return s, "DRAW"
    m = matches[-1]
    return (s[: m.start()] + s[m.end():]).strip(), m.group(1).upper()


def ask(ticker: str, question: str, force_refresh: bool = False) -> dict:
    ticker = ticker.upper()
    now = time.time()
    cached = _cache.get(ticker)
    is_fresh = force_refresh or not cached or (now - cached["builtAt"]) >= CACHE_TTL

    if is_fresh:
        context = _gather_context(ticker)
        bull = _bull_take(ticker, context)
        bear = _bear_take(ticker, context)
        pm, winner = _split_winner(_pm_verdict(ticker, context, bull, bear, question))
        debate = {"builtAt": now, "context": context, "bull": bull, "bear": bear, "pm": pm, "winner": winner}
        _cache[ticker] = debate
        answer = pm
    else:
        debate = cached
        answer = _follow_up(ticker, debate, question)

    return {
        "ticker": ticker,
        "question": question,
        "answer": answer,
        "bull": debate["bull"],
        "bear": debate["bear"],
        "pmVerdict": debate["pm"],
        "winner": debate.get("winner", "DRAW"),
        "freshDebate": is_fresh,
        "debateAgeSec": round(now - debate["builtAt"]),
    }
