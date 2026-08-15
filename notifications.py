"""Push notifications via ntfy.sh.

No account, no API key, no email credentials to store: pick a private topic
name, subscribe to it in the ntfy app (iOS/Android) or at ntfy.sh/<topic> in
a browser, and put that topic in NTFY_TOPIC in .env. Anyone who knows the
topic name can read it, so make it a long, unguessable string.
"""
import os

import requests
from dotenv import load_dotenv

load_dotenv()

NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
NTFY_SERVER = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")


def send_notification(title: str, message: str, priority: str = "default") -> bool:
    """Best-effort push. Returns False (never raises) if NTFY_TOPIC isn't set
    or the request fails, so a notification hiccup never breaks an order flow."""
    if not NTFY_TOPIC:
        print(f"[notify] NTFY_TOPIC not set, skipping push: {title} — {message}")
        return False
    try:
        resp = requests.post(
            f"{NTFY_SERVER}/{NTFY_TOPIC}",
            data=message.encode("utf-8"),
            headers={"Title": title, "Priority": priority},
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        print(f"[notify] Failed to send push notification: {e}")
        return False
