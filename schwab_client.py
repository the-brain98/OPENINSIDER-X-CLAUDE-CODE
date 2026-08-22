import requests

from schwab_auth import get_access_token

TRADER_BASE = "https://api.schwabapi.com/trader/v1"
MARKETDATA_BASE = "https://api.schwabapi.com/marketdata/v1"


def _headers() -> dict:
    return {"Authorization": f"Bearer {get_access_token()}"}


def get_account_numbers() -> list:
    resp = requests.get(f"{TRADER_BASE}/accounts/accountNumbers", headers=_headers())
    resp.raise_for_status()
    return resp.json()


def get_accounts(fields: str = "positions") -> list:
    resp = requests.get(
        f"{TRADER_BASE}/accounts", headers=_headers(), params={"fields": fields}
    )
    resp.raise_for_status()
    return resp.json()


def get_quotes(symbols: list) -> dict:
    resp = requests.get(
        f"{MARKETDATA_BASE}/quotes",
        headers=_headers(),
        params={"symbols": ",".join(symbols)},
    )
    resp.raise_for_status()
    return resp.json()


def get_movers(symbol_id: str, sort: str = "PERCENT_CHANGE_UP", frequency: int = 0) -> list:
    """Top movers for an index/exchange, e.g. "$SPX", "NYSE", "NASDAQ".
    sort: VOLUME | TRADES | PERCENT_CHANGE_UP | PERCENT_CHANGE_DOWN."""
    resp = requests.get(
        f"{MARKETDATA_BASE}/movers/{symbol_id}",
        headers=_headers(),
        params={"sort": sort, "frequency": frequency},
    )
    resp.raise_for_status()
    return resp.json().get("screeners", [])


def get_orders(account_hash: str, status: str | None = None, lookback_days: int = 7) -> list:
    """Orders entered in the trailing `lookback_days` (Schwab requires an explicit
    time window). `status` can narrow to e.g. "FILLED" or "WORKING"."""
    import datetime

    now = datetime.datetime.now(datetime.timezone.utc)
    start = now - datetime.timedelta(days=lookback_days)
    params = {
        "fromEnteredTime": start.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "toEnteredTime": now.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    }
    if status:
        params["status"] = status
    resp = requests.get(
        f"{TRADER_BASE}/accounts/{account_hash}/orders", headers=_headers(), params=params
    )
    resp.raise_for_status()
    return resp.json()


def get_order(account_hash: str, order_id: str) -> dict:
    resp = requests.get(
        f"{TRADER_BASE}/accounts/{account_hash}/orders/{order_id}", headers=_headers()
    )
    resp.raise_for_status()
    return resp.json()


def get_price_history(symbol: str) -> list:
    """Daily candles for the trailing ~1 month, oldest first."""
    resp = requests.get(
        f"{MARKETDATA_BASE}/pricehistory",
        headers=_headers(),
        params={
            "symbol": symbol,
            "periodType": "month",
            "period": 1,
            "frequencyType": "daily",
            "frequency": 1,
        },
    )
    resp.raise_for_status()
    return resp.json().get("candles", [])


if __name__ == "__main__":
    import json

    print(json.dumps(get_accounts(), indent=2))
