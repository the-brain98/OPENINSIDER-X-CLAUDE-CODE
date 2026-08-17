# Politicians data

Congressional stock trade disclosures (Senate + House Periodic Transaction
Reports under the STOCK Act), scraped directly from the primary government
sources and stored in a local DuckDB file.

`schema.py`, `scrape_senate.py`, `scrape_house.py`, and `entities.py` are
vendored, unmodified, from [Quantgress](https://github.com/DMulajkar/Quantgress)
by DMulajkar -- a self-hosted, open-source alternative to Quiver Quantitative
(MIT licensed, see `LICENSE_QUANTGRESS`). Only the congress-trades phases
(Senate scraper, House scraper, ticker resolution) are carried over; Quantgress
itself has 15 more scrapers (lobbying, 13F, patents, FEC donations, etc.) that
this dashboard doesn't use.

- **Senate**: [efdsearch.senate.gov](https://efdsearch.senate.gov/) -- HTML tables, no OCR needed
- **House**: [disclosures-clerk.house.gov](https://disclosures-clerk.house.gov/) -- scanned/born-digital PDFs, parsed with `pdfplumber`
- **Ticker resolution**: tickers embedded in the filing's free-text asset name (e.g. `"Apple Inc. (AAPL)"`) are extracted directly; no fuzzy matching

`congress_trades.duckdb` ships pre-populated with a real backfill so the
Politicians tab works out of the box. It's gitignored from here on (like
`tokens.json` elsewhere in this repo) since it's a local data artifact, not
source -- re-running the scrapers grows and changes it on every refresh.

## Refreshing

```bash
pip install -r politicians/requirements-refresh.txt   # one-time: adds pdfplumber for House PDFs
cd politicians
python refresh.py
```

Ticker resolution (`entities.py`) hits SEC's `company_tickers.json`, which requires a
contact email in the request's User-Agent -- set `SEC_CONTACT_EMAIL` in your
`.env` (see `.env.example`) before running a refresh. There's no hardcoded
default; a missing value fails loudly instead of quietly using someone else's
identity.

`requirements-refresh.txt` is separate from the main `requirements.txt` because
`pdfplumber` pulls in `cryptography`, which needs a Rust toolchain to build
from source if PyPI has no prebuilt wheel for your Python version/platform. If
that install fails, `pip install --upgrade pip` first (an old pip's resolver
is often why it picks a `cryptography` version with no wheel available), or
install Rust (`brew install rust` on macOS) and let it build.

Incremental -- already-scraped filings are skipped, so this is safe to run
daily (STOCK Act gives filers 30-45 days to disclose, so once a day is plenty)
or just whenever you want to check for new filings. A full backfill from
scratch takes about 1.3 hours against ~2,400 filings, self-throttled to be
polite to the .gov hosts; the bundled `.duckdb` already has that done.

## What's NOT in here

Congressional disclosures only require a **dollar range** per trade (e.g.
"$1,001 - $15,000"), never an exact price or share count -- that's a STOCK Act
requirement, not a scraping limitation. There is no "shares bought" field
anywhere in this data, by law.

Party affiliation isn't in the disclosure data either (filings only carry a
name and an office code) -- the dashboard resolves it separately by joining
against the `unitedstates/congress-legislators` public-domain dataset. See
`../party_lookup.py`.
