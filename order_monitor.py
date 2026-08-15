"""Background poller that watches for protective (max-loss / sell-target) orders
filling and pushes a plain-language notification when they do.

Runs as a daemon thread inside the dashboard process — no separate service to
manage. State (which order IDs have already been notified about) is persisted
to disk so a dashboard restart doesn't re-fire notifications for old fills.
"""
import json
import threading
import time
from pathlib import Path

from notifications import send_notification
from schwab_client import get_account_numbers, get_orders

_PROJECT_ROOT = Path(__file__).resolve().parent
STATE_PATH = _PROJECT_ROOT / "order_notify_state.json"


def _leaf_orders(order: dict):
    """OCO brackets nest their two legs under childOrderStrategies; yield the
    actual sellable order(s), recursing in case of further nesting."""
    children = order.get("childOrderStrategies")
    if children:
        for child in children:
            yield from _leaf_orders(child)
    else:
        yield order


def _extract_fill_price(order: dict):
    for activity in order.get("orderActivityCollection", []) or []:
        for leg in activity.get("executionLegs", []) or []:
            if "price" in leg:
                return leg["price"]
    return order.get("price") or order.get("stopPrice")


def _plain_label(order_type: str) -> str:
    return {"STOP": "maximum loss", "LIMIT": "sell target price"}.get(order_type, order_type)


def _load_state() -> set:
    if STATE_PATH.exists():
        try:
            return set(json.loads(STATE_PATH.read_text()))
        except (json.JSONDecodeError, OSError):
            return set()
    return set()


def _save_state(notified_ids: set) -> None:
    STATE_PATH.write_text(json.dumps(sorted(notified_ids)))


def check_once(notified_ids: set) -> set:
    """Poll every account once for newly-filled protective sell orders. Returns
    the updated set of order IDs that have been notified about."""
    updated = set(notified_ids)
    try:
        accounts = get_account_numbers()
    except Exception as e:
        print(f"[monitor] couldn't list accounts: {e}")
        return updated

    for acct in accounts:
        account_hash = acct["hashValue"]
        try:
            orders = get_orders(account_hash, lookback_days=7)
        except Exception as e:
            print(f"[monitor] couldn't fetch orders for {account_hash}: {e}")
            continue

        for order in orders:
            for leaf in _leaf_orders(order):
                order_id = str(leaf.get("orderId"))
                order_type = leaf.get("orderType")
                legs = leaf.get("orderLegCollection") or []
                is_protective_sell = order_type in ("STOP", "LIMIT") and any(
                    leg.get("instruction") == "SELL" for leg in legs
                )
                if not is_protective_sell:
                    continue
                if leaf.get("status") != "FILLED" or order_id in updated:
                    continue

                symbol = legs[0]["instrument"]["symbol"] if legs else "?"
                qty = legs[0].get("quantity", "?") if legs else "?"
                price = _extract_fill_price(leaf)
                price_str = f"${price:.2f}" if isinstance(price, (int, float)) else str(price)
                label = _plain_label(order_type)

                send_notification(
                    f"{symbol} sold — {label} hit",
                    f"Sold {qty} share(s) of {symbol} at {price_str}. Your {label} order filled.",
                )
                updated.add(order_id)

    return updated


def run_forever(interval_seconds: int = 60) -> None:
    notified_ids = _load_state()
    while True:
        notified_ids = check_once(notified_ids)
        _save_state(notified_ids)
        time.sleep(interval_seconds)


def start_background_monitor(interval_seconds: int = 60) -> threading.Thread:
    thread = threading.Thread(target=run_forever, args=(interval_seconds,), daemon=True)
    thread.start()
    return thread
