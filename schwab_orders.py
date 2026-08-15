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
    location = resp.headers.get("Location", "")
    return {"status_code": resp.status_code, "order_id": location.rstrip("/").rsplit("/", 1)[-1] or None}


def _protective_leg(symbol: str, quantity: int, order_type: str, price_field: str, price: float) -> dict:
    return {
        "orderType": order_type,
        "session": "NORMAL",
        "duration": "GOOD_TILL_CANCEL",
        price_field: f"{price:.2f}",
        "orderStrategyType": "SINGLE",
        "orderLegCollection": [
            {
                "instruction": "SELL",
                "quantity": quantity,
                "instrument": {"symbol": symbol, "assetType": "EQUITY"},
            }
        ],
    }


def place_protective_orders(
    account_hash: str,
    symbol: str,
    quantity: int,
    max_loss_price: float | None = None,
    sell_target_price: float | None = None,
) -> dict:
    """Set a "sell if it drops to" (stop-loss) and/or "sell if it rises to"
    (limit) order against an existing position.

    If both prices are given, they're placed as a single OCO bracket so that
    whichever side triggers first automatically cancels the other. Without
    that, both could fill independently on different days and you'd end up
    with a sell order still open for shares you no longer hold.
    """
    if max_loss_price is None and sell_target_price is None:
        raise ValueError("Provide at least one of max_loss_price or sell_target_price")

    stop_leg = (
        _protective_leg(symbol, quantity, "STOP", "stopPrice", max_loss_price)
        if max_loss_price is not None
        else None
    )
    limit_leg = (
        _protective_leg(symbol, quantity, "LIMIT", "price", sell_target_price)
        if sell_target_price is not None
        else None
    )

    if stop_leg and limit_leg:
        order = {"orderStrategyType": "OCO", "childOrderStrategies": [stop_leg, limit_leg]}
    else:
        order = stop_leg or limit_leg

    resp = requests.post(
        f"{TRADER_BASE}/accounts/{account_hash}/orders",
        headers={"Authorization": f"Bearer {get_access_token()}"},
        json=order,
    )
    resp.raise_for_status()
    location = resp.headers.get("Location", "")
    return {"status_code": resp.status_code, "order_id": location.rstrip("/").rsplit("/", 1)[-1] or None}


def cancel_order(account_hash: str, order_id: str) -> dict:
    resp = requests.delete(
        f"{TRADER_BASE}/accounts/{account_hash}/orders/{order_id}",
        headers={"Authorization": f"Bearer {get_access_token()}"},
    )
    resp.raise_for_status()
    return {"status_code": resp.status_code}


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
