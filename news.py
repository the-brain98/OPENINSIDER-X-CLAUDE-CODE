"""Headlines via Google News RSS — licensed for personal, non-commercial feed-reader use."""
import xml.etree.ElementTree as ET

import requests

RSS_URL = "https://news.google.com/rss/search"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; portfolio-dashboard/1.0)"}


def get_headlines(query: str, limit: int = 5) -> list[dict]:
    resp = requests.get(
        RSS_URL,
        params={"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"},
        headers=HEADERS,
        timeout=10,
    )
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    items = root.findall(".//item")[:limit]
    return [
        {
            "title": item.findtext("title", ""),
            "link": item.findtext("link", ""),
            "source": item.findtext("source", ""),
            "pubDate": item.findtext("pubDate", ""),
        }
        for item in items
    ]
