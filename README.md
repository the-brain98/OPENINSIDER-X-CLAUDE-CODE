# Schwab Insider-Trade Dashboard

A local web dashboard for a Schwab **individual/retail** brokerage account. Combines live account data with an insider-purchase screener and a transparent conviction-scoring formula — runs entirely on your own machine.

## Features

- **Live positions** — balances, holdings, current price, and % change across 1D / 3D / 5D / 1M / All-Time, with a sparkline trend chart per position
- **Insider purchase screener** — pulls recent insider buys from openinsider.com, filterable by max price, minimum share quantity, and insider title (e.g. "CEO")
- **Conviction scoring** — insider-purchase clusters ranked 0–100 by a documented point formula (cluster size, dollar amount committed, insider seniority, stake-percentage increase, recency). This is a plain formula, not an AI/LLM call — fully readable in `quant_score.py`, not a black box
- **News** — recent headlines per ticker, fetched on demand
- **Manual order placement** — place real market orders through Schwab's Trader API, gated behind an explicit click and a confirmation dialog. Nothing trades automatically

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

## Notes

- Everything runs locally — nothing is hosted or shared by default; the only outbound calls are to Schwab's API, openinsider.com, and Google News RSS
- No trades are ever placed automatically — every buy requires a manual click plus a confirmation dialog
- The conviction score is not investment advice — it's a transparent, auditable formula over publicly visible signals, not a recommendation engine
