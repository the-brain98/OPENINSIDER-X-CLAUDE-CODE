"""Resolve a congressional trader's party affiliation.

Congress trade disclosures (Senate/House PTRs) carry a name and an office
code, never a party -- so this joins against the `unitedstates/congress-
legislators` project (public-domain, MIT-adjacent, maintained by the same
community behind GovTrack/ProPublica-style tools). It ships every member of
Congress since ~1789 with per-term party, state, and district, which is
exactly what's needed to resolve "which party was this person in on the date
they made this trade."

Matching is last-name + chamber first, narrowed by state (House office codes
like "AL04" embed it; Senate does not) and then by first-name prefix if a
last name is still ambiguous. An unresolved or genuinely ambiguous name
returns "Unknown" rather than guessing -- misattributing a party is worse
than admitting we don't know.
"""
import json
import os
import re
import time

import requests
import yaml

CURRENT_URL = "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml"
HISTORICAL_URL = "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-historical.yaml"

CACHE_PATH = os.path.join(os.path.dirname(__file__), "politicians", "legislators_cache.json")
CACHE_TTL = 30 * 24 * 3600  # legislator rosters change on election/appointment timescales, not daily

PARTY_SHORT = {
    "Democrat": "D",
    "Republican": "R",
    "Independent": "I",
    "Libertarian": "L",
}

_index = None  # {(chamber_type, last_lower): [entry, ...]}, built lazily


def _normalize(name):
    return re.sub(r"[^a-z]", "", (name or "").lower())


def _fetch_and_slim():
    """Download both legislator rosters and reduce to just what resolution needs."""
    entries = []
    for url in (CURRENT_URL, HISTORICAL_URL):
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        for person in yaml.safe_load(resp.text):
            first = person.get("name", {}).get("first", "")
            last = person.get("name", {}).get("last", "")
            terms = [
                {
                    "type": t.get("type"),
                    "state": t.get("state"),
                    "district": t.get("district"),
                    "party": t.get("party"),
                    "start": t.get("start"),
                    "end": t.get("end"),
                }
                for t in person.get("terms", [])
                if t.get("type") in ("sen", "rep")
            ]
            if terms:
                entries.append({"first": first, "last": last, "terms": terms})
    return entries


def _load_entries():
    if os.path.exists(CACHE_PATH) and time.time() - os.path.getmtime(CACHE_PATH) < CACHE_TTL:
        with open(CACHE_PATH) as f:
            return json.load(f)

    entries = _fetch_and_slim()
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w") as f:
        json.dump(entries, f)
    return entries


def _build_index():
    global _index
    if _index is not None:
        return _index
    _index = {}
    for entry in _load_entries():
        last_key = _normalize(entry["last"])
        chambers = {t["type"] for t in entry["terms"]}
        for chamber_type in chambers:
            _index.setdefault((chamber_type, last_key), []).append(entry)
    return _index


def _term_for_date(entry, chamber_type, txn_date):
    candidates = [t for t in entry["terms"] if t["type"] == chamber_type]
    if not candidates:
        return None
    if txn_date:
        on_date = [t for t in candidates if t["start"] <= txn_date <= (t["end"] or "9999-12-31")]
        if on_date:
            return on_date[-1]
    return candidates[-1]  # no date, or date outside every term -- best guess is the most recent


def lookup_party(first_name, last_name, chamber, office=None, txn_date=None):
    """chamber: 'S' or 'H'. office: the raw office string from the filing
    (House PTRs encode state+district like "AL04"; Senate PTRs don't carry
    state at all). txn_date: 'YYYY-MM-DD' string or None.

    Returns (party_full, party_short) e.g. ("Democrat", "D"), or ("Unknown", "?").
    """
    chamber_type = "sen" if chamber == "S" else "rep"
    index = _build_index()
    candidates = index.get((chamber_type, _normalize(last_name)), [])

    if not candidates:
        return "Unknown", "?"

    if len(candidates) > 1 and chamber_type == "rep" and office and len(office) >= 2:
        state = office[:2].upper()
        narrowed = [e for e in candidates if any(t["state"] == state for t in e["terms"] if t["type"] == "rep")]
        if narrowed:
            candidates = narrowed

    if len(candidates) > 1:
        first_norm = _normalize(first_name)
        narrowed = [e for e in candidates if first_norm.startswith(_normalize(e["first"])) or _normalize(e["first"]).startswith(first_norm)]
        if len(narrowed) == 1:
            candidates = narrowed

    if len(candidates) != 1:
        return "Unknown", "?"

    term = _term_for_date(candidates[0], chamber_type, txn_date)
    if not term or not term.get("party"):
        return "Unknown", "?"
    party = term["party"]
    return party, PARTY_SHORT.get(party, party[:1].upper())
