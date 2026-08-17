"""Incremental refresh: Senate + House PTRs (current & prior year), then ticker resolution.

Congress-trades-only subset of Quantgress's daily.py -- this vendored copy only
carries the Senate/House scrapers, not Quantgress's other 15 datasets, so it
calls just those three steps directly instead of importing the upstream driver.

STOCK Act gives filers 30-45 days to disclose, so once a day (or on demand) is
plenty. Each step resumes on its own (senate skips links already in
senate_trades, house skips doc_ids already in house_filings), so re-running
after an interruption just picks up where it left off.

    python refresh.py            # senate (all years) + house (this year, last year) + tickers
"""
import datetime

import entities
import scrape_house
import scrape_senate


def house_years(today=None):
    y = (today or datetime.date.today()).year
    return [y - 1, y]


def main():
    print(f"=== Politicians data refresh: {datetime.datetime.now()} ===")

    print("\n--- Senate ---")
    scrape_senate.main()

    years = house_years()
    print(f"\n--- House {years} ---")
    scrape_house.main(years)

    print("\n--- Resolve tickers ---")
    entities.main()


if __name__ == "__main__":
    main()
