import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, jsonify, request, render_template

from schwab_client import get_accounts, get_account_numbers, get_quotes, get_price_history
from schwab_orders import place_market_buy
from insider_screener import fetch_purchases_under
from quant_score import score_clusters
from news import get_headlines

app = Flask(__name__)


def _balances(account: dict) -> dict:
    bal = account["securitiesAccount"].get("currentBalances", {})
    buying_power = bal.get("buyingPower", bal.get("cashAvailableForTrading", 0))
    return {
        "accountNumber": account["securitiesAccount"]["accountNumber"],
        "type": account["securitiesAccount"]["type"],
        "buyingPower": round(buying_power, 2),
        "liquidationValue": round(bal.get("liquidationValue", 0), 2),
    }


def _pct_change(current: float, past: float) -> float | None:
    if not past:
        return None
    return round((current - past) / past * 100, 2)


def _enrich_position(pos: dict) -> dict:
    instrument = pos["instrument"]
    symbol = instrument["symbol"]
    qty = pos.get("longQuantity", 0)
    avg_price = pos.get("averageLongPrice", 0)
    result = {
        "symbol": symbol,
        "description": instrument.get("description", ""),
        "assetType": instrument.get("assetType"),
        "qty": qty,
        "avgPrice": avg_price,
        "marketValue": pos.get("marketValue", 0),
        "currentPrice": None,
        "change1D": None,
        "change3D": None,
        "change5D": None,
        "change1M": None,
        "changeAllTime": None,
        "sparkline": [],
    }

    if instrument.get("assetType") != "EQUITY":
        return result  # mutual funds etc. skip live quote/history calls

    try:
        quote = get_quotes([symbol])[symbol]["quote"]
        current = quote["lastPrice"]
        result["currentPrice"] = current
        result["change1D"] = round(quote.get("netPercentChange", 0), 2)
        result["changeAllTime"] = _pct_change(current, avg_price)

        candles = get_price_history(symbol)
        if candles:
            result["change3D"] = _pct_change(current, candles[-4]["close"]) if len(candles) >= 4 else None
            result["change5D"] = _pct_change(current, candles[-6]["close"]) if len(candles) >= 6 else None
            result["change1M"] = _pct_change(current, candles[0]["close"])
            result["sparkline"] = [c["close"] for c in candles] + [current]
    except Exception as e:
        result["error"] = str(e)

    return result


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/portfolio")
def api_portfolio():
    accounts = get_accounts(fields="positions")
    out = []
    for acct in accounts:
        entry = _balances(acct)
        positions = acct["securitiesAccount"].get("positions", [])
        entry["positions"] = [_enrich_position(p) for p in positions]
        out.append(entry)
    return jsonify(out)


def _parse_filters(args) -> tuple[float, int, list[str] | None]:
    """Blank/missing fields mean 'no limit', not a crash."""
    max_price_raw = (args.get("max_price") or "").strip()
    max_price = float(max_price_raw) if max_price_raw else 9999.0  # openinsider's own field cap

    min_qty_raw = (args.get("min_qty") or "").strip()
    min_qty = int(min_qty_raw) if min_qty_raw else 0

    titles_raw = (args.get("titles") or "").strip()
    titles = [t.strip() for t in titles_raw.split(",") if t.strip()] or None

    return max_price, min_qty, titles


@app.route("/api/insiders")
def api_insiders():
    try:
        max_price, min_qty, titles = _parse_filters(request.args)
    except ValueError as e:
        return jsonify({"error": f"Invalid filter value: {e}"}), 400

    df = fetch_purchases_under(max_price, max_rows=1000, min_qty=min_qty, titles=titles)
    df = df.head(100)
    # df.to_dict() leaves NaN as float('nan'), which jsonify serializes as the bare
    # token `NaN` -- invalid per the JSON spec, so browsers' JSON.parse() rejects it.
    # pandas' own to_json() correctly emits `null` instead.
    return app.response_class(df.to_json(orient="records"), mimetype="application/json")


@app.route("/api/insiders/ranked")
def api_insiders_ranked():
    try:
        max_price, min_qty, titles = _parse_filters(request.args)
    except ValueError as e:
        return jsonify({"error": f"Invalid filter value: {e}"}), 400
    top_n = int(request.args.get("top_n") or 5)

    df = fetch_purchases_under(max_price, max_rows=1000, min_qty=min_qty, titles=titles)
    ranked = score_clusters(df)
    return jsonify(ranked[:top_n])


@app.route("/api/news/<ticker>")
def api_news(ticker):
    try:
        headlines = get_headlines(f"{ticker.upper()} stock", limit=5)
        return jsonify(headlines)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/accounts/hashes")
def api_account_hashes():
    return jsonify(get_account_numbers())


@app.route("/api/orders", methods=["POST"])
def api_place_order():
    body = request.get_json(force=True)
    account_hash = body["accountHash"]
    symbol = body["symbol"].upper()
    qty = int(body["qty"])

    result = place_market_buy(account_hash, symbol, qty)
    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True, port=5757)
