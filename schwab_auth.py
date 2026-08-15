"""OAuth 2.0 authorization-code flow for the Schwab Trader API.

Access tokens last 30 minutes; refresh tokens last 7 days and must be
re-issued via a fresh browser login once they expire (Schwab does not
support long-lived offline refresh).
"""
import base64
import json
import os
import time
import urllib.parse
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

AUTH_BASE = "https://api.schwabapi.com/v1/oauth/authorize"
TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token"

APP_KEY = os.environ["SCHWAB_APP_KEY"]
APP_SECRET = os.environ["SCHWAB_APP_SECRET"]
CALLBACK_URL = os.environ.get("SCHWAB_CALLBACK_URL", "https://127.0.0.1")

# Anchor to this file's directory so the token cache is found regardless of
# which directory a script (e.g. the dashboard, run from dashboard/) is launched from.
_PROJECT_ROOT = Path(__file__).resolve().parent
TOKEN_PATH = Path(os.environ.get("SCHWAB_TOKEN_PATH")) if os.environ.get("SCHWAB_TOKEN_PATH") else _PROJECT_ROOT / "tokens.json"
if not TOKEN_PATH.is_absolute():
    TOKEN_PATH = _PROJECT_ROOT / TOKEN_PATH


def _basic_auth_header() -> dict:
    raw = f"{APP_KEY}:{APP_SECRET}".encode()
    return {"Authorization": f"Basic {base64.b64encode(raw).decode()}"}


def build_authorize_url() -> str:
    params = {
        "client_id": APP_KEY,
        "redirect_uri": CALLBACK_URL,
        "response_type": "code",
    }
    return f"{AUTH_BASE}?{urllib.parse.urlencode(params)}"


def _save_tokens(token_data: dict) -> None:
    token_data["obtained_at"] = time.time()
    TOKEN_PATH.write_text(json.dumps(token_data, indent=2))


def _load_tokens() -> dict:
    if not TOKEN_PATH.exists():
        raise FileNotFoundError(
            f"No {TOKEN_PATH} found. Run `python schwab_login.py` first."
        )
    return json.loads(TOKEN_PATH.read_text())


def exchange_code_for_tokens(auth_code: str) -> dict:
    resp = requests.post(
        TOKEN_URL,
        headers={
            **_basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={
            "grant_type": "authorization_code",
            "code": auth_code,
            "redirect_uri": CALLBACK_URL,
        },
    )
    if not resp.ok:
        print(f"Schwab token exchange failed ({resp.status_code}): {resp.text}")
    resp.raise_for_status()
    token_data = resp.json()
    _save_tokens(token_data)
    return token_data


def refresh_access_token() -> dict:
    tokens = _load_tokens()
    resp = requests.post(
        TOKEN_URL,
        headers={
            **_basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
        },
    )
    resp.raise_for_status()
    token_data = resp.json()
    _save_tokens(token_data)
    return token_data


def get_access_token() -> str:
    """Return a valid access token, refreshing if the cached one is stale."""
    tokens = _load_tokens()
    age = time.time() - tokens.get("obtained_at", 0)
    if age > tokens.get("expires_in", 1800) - 60:
        tokens = refresh_access_token()
    return tokens["access_token"]
