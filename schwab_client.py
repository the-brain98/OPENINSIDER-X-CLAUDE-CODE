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
