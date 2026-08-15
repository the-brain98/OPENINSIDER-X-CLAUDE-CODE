"""Manual, per-trade order placement. You run this yourself and confirm each order.

There is deliberately no code path here that chains screener results directly
into an order without a human typing "yes" first.
"""
import requests

from schwab_auth import get_access_token
from schwab_client import TRADER_BASE, get_account_numbers


def place_market_buy(account_hash: str, symbol: str, quantity: int) -> dict:
    order = {
        "orderType": "MARKET",
        "session": "NORMAL",
        "duration": "DAY",
        "orderStrategyType": "SINGLE",
        "orderLegCollection": [
            {
                "instruction": "BUY",
                "quantity": quantity,
                "instrument": {"symbol": symbol, "assetType": "EQUITY"},
            }
        ],
    }
    resp = requests.post(
        f"{TRADER_BASE}/accounts/{account_hash}/orders",
        headers={"Authorization": f"Bearer {get_access_token()}"},
        json=order,
    )
    resp.raise_for_status()
    return {"status_code": resp.status_code, "order_id": resp.headers.get("Location")}


def confirm_and_buy(account_hash: str, symbol: str, quantity: int) -> None:
    answer = input(f"Confirm: BUY {quantity} shares of {symbol} at market? [y/N] ")
    if answer.strip().lower() != "y":
        print("Cancelled.")
        return
    result = place_market_buy(account_hash, symbol, quantity)
    print(result)


if __name__ == "__main__":
    accounts = get_account_numbers()
    print("Your accounts:", accounts)
    print("Usage: from schwab_orders import confirm_and_buy; confirm_and_buy(hash, 'TICKER', qty)")
