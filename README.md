# Schwab Insider-Trade Dashboard

A local web dashboard for a Schwab **individual/retail** brokerage account. Combines live account data with an insider-purchase screener and a transparent conviction-scoring formula — runs entirely on your own machine.

## Features

- **Live positions** — balances, holdings, current price, and % change across 1D / 3D / 5D / 1M / All-Time, with a sparkline trend chart per position
- **Insider purchase screener** — pulls recent insider buys from openinsider.com, filterable by max price, minimum share quantity, and insider title (e.g. "CEO")
- **Conviction scoring** — insider-purchase clusters ranked 0–100 by a documented point formula (cluster size, dollar amount committed, insider seniority, stake-percentage increase, recency). This is a plain formula, not an AI/LLM call — fully readable in `quant_score.py`, not a black box
- **News** — recent headlines per ticker, fetched on demand
- **Manual order placement** — place real market orders through Schwab's Trader API, gated behind an explicit click and a confirmation dialog. Nothing trades automatically
- **Position protection** — per position, set a "sell if it drops to" (max loss) and/or "sell if it rises to" (sell target) price in plain language. If you set both, they're placed as one bracket order so that whichever hits first cancels the other. You get a push notification the moment either one fires

## Requirements

- A Schwab **individual/retail** brokerage account (this uses Schwab's retail Trader API — different from Schwab Advisor Services, which is a separate product for RIAs)
- Python 3.10+
- A Schwab Developer app (see setup below)

## Setup

### 1. Get Schwab API credentials

1. Go to [developer.schwab.com](https://developer.schwab.com) and sign in with your Schwab login
2. Create an app, selecting both the **Accounts and Trading Production** and **Market Data Production** API products
3. Set the callback URL to `https://127.0.0.1`
4. Once approved, note your **App Key** and **App Secret**

### 2. Clone and install

```bash
git clone <this-repo-url>
cd schwab-integration
pip install -r requirements.txt
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```
SCHWAB_APP_KEY=your_app_key
SCHWAB_APP_SECRET=your_app_secret
SCHWAB_CALLBACK_URL=https://127.0.0.1
SCHWAB_TOKEN_PATH=tokens.json
```

`.env` is gitignored — never commit real credentials.

### 3b. (Optional) Turn on push notifications

Position protection alerts (your max-loss or sell-target order filling) are sent via [ntfy.sh](https://ntfy.sh) — free, no account needed:

1. Install the ntfy app ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)), or just use a browser at `ntfy.sh/<topic>`
2. Pick a long, hard-to-guess topic name (e.g. `my-trading-alerts-a8f3e91`) and subscribe to it in the app
3. Put that same topic in `.env` as `NTFY_TOPIC=my-trading-alerts-a8f3e91`

Anyone who knows your topic name can read those notifications, so don't use something guessable. Leave `NTFY_TOPIC` blank to skip notifications entirely — everything else still works.

### 4. Log in

```bash
python schwab_login.py
```

This opens a browser to log into Schwab and approve access. After approving, you'll land on a broken-looking `https://127.0.0.1/?code=...` page — that's expected, nothing is actually running there. Copy the full URL from the address bar and paste it back into the terminal when prompted, quickly — the authorization code expires in under a minute.

Tokens are cached in `tokens.json` (also gitignored). The access token auto-refreshes; the refresh token lasts about 7 days, after which you rerun this script.

### 5. Run the dashboard

```bash
cd dashboard
python app.py
```

Open `http://127.0.0.1:5757`.

## Security

- This app only listens on `127.0.0.1` (localhost) — it is never reachable from your network or the internet, on this machine or anyone else's, regardless of whether this repo is public or private
- Forking or cloning this repo gives someone the *code*, not access to any account. Every user must create their own Schwab Developer app and complete their own Schwab login (username + password + MFA, on Schwab's own site) to get a working `tokens.json` — there is no shared credential or backend anywhere in this code
- `.env` and `tokens.json` are gitignored and were never committed to this repo's history — check before you push if you fork this, since a leaked App Secret or token would let someone place trades on *your* account
- The conviction score, insider screener, and protective-order logic are plain, readable Python — nothing here calls out to an LLM or a third party with your account data, aside from the specific outbound calls listed above (Schwab, openinsider.com, Google News RSS, and ntfy.sh if configured)

## Notes

- Everything runs locally — nothing is hosted or shared by default; the only outbound calls are to Schwab's API, openinsider.com, Google News RSS, and (if configured) ntfy.sh for push notifications
- No trades are ever placed automatically by this dashboard — every buy requires a manual click plus a confirmation dialog. Max-loss/sell-target orders you set under "Protect" *are* real standing sell orders sitting on Schwab's books, exactly like a manual stop-loss or limit order you'd place yourself, and will execute without further clicks once triggered — that's the point of them
- The conviction score is not investment advice — it's a transparent, auditable formula over publicly visible signals, not a recommendation engine
- Push notifications for protective orders are sent by a background thread inside the dashboard process, polling Schwab every 60s — it only fires while `dashboard/app.py` is running

## License

MIT — see [LICENSE](LICENSE). Provided as-is, for personal/educational use; not investment advice.
