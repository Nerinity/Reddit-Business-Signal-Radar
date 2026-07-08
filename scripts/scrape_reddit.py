#!/usr/bin/env python3
"""Reddit raw signal scraper.

This script is now window-first and parquet-first:
  daily-live      -> reddit_json + reddit_rss over the recent live window
  weekly-backfill -> arctic_shift_reddit over a finalized prior week

Dashboard trend windows should use published_at/event_date. collected_at and
ingestion_date are ingestion/audit metadata only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import random
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import pandas as pd
import requests

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.pipeline.audit import append_audit_rows
from signal_radar.pipeline.io import (
    iso_to_date,
    load_existing_mention_ids,
    refresh_legacy_raw_csv,
    write_raw_parquet,
)
from signal_radar.pipeline.state import load_json_state, save_json_state, update_source_state, utc_now_iso

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler()],
)
log = logging.getLogger("scrape_reddit")

RAW_DIR = ROOT / "data" / "raw"
LEGACY_CSV = RAW_DIR / "scraped_2026_large.csv"
STATE_FILE = ROOT / "data" / "state" / "scrape_source_state.json"
AUDIT_FILE = ROOT / "data" / "audit" / "scrape_source_status.parquet"

USER_AGENT = "RedditBusinessSignalRadar/0.1 (research project; contact via GitHub)"
ARCTIC_SHIFT_BASE = "https://arctic-shift.photon-reddit.com/api"
REDDIT_JSON_BASE = "https://www.reddit.com"
DEFAULT_SAFETY_CAP = 250_000

REDDIT_ID_RE = re.compile(r"(?:https?://(?:www\.|old\.)?reddit\.com)?/r/[^/]+/comments/([A-Za-z0-9]+)/?", re.I)

try:
    with open(ROOT / "configs" / "sources.json", encoding="utf-8") as f:
        _cfg = json.load(f)
    SUBREDDIT_CATEGORIES: dict[str, list[str]] = _cfg["reddit"]["subreddit_categories"]
    log.info(
        "Loaded %d subreddit groups (%d total subs)",
        len(SUBREDDIT_CATEGORIES),
        sum(len(v) for v in SUBREDDIT_CATEGORIES.values()),
    )
except Exception as exc:
    log.warning("Could not load sources.json (%s); no subreddits configured", exc)
    SUBREDDIT_CATEGORIES = {}


@dataclass
class FetchResult:
    response: requests.Response | None
    status: str
    counters: dict[str, int]
    error_type: str = ""
    error_message: str = ""


def _stable_hash(*parts: object) -> str:
    joined = "||".join("" if p is None else str(p) for p in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:24]


def _normalize_text_for_hash(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _parse_dt(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return pd.to_datetime(value, utc=True).to_pydatetime()
    except Exception:
        return None


def _date_to_ts(value: str, end: bool = False) -> int:
    suffix = "T23:59:59+00:00" if end else "T00:00:00+00:00"
    return int(datetime.fromisoformat(value + suffix).timestamp())


def _in_window(published_at: str, start_date: str, end_date: str) -> bool:
    dt = _parse_dt(published_at)
    if dt is None:
        return False
    return _date_to_ts(start_date) <= int(dt.timestamp()) <= _date_to_ts(end_date, end=True)


def parse_reddit_id(url: str = "", native_id: str | None = None) -> str:
    if native_id:
        return str(native_id).strip()
    match = REDDIT_ID_RE.search(url or "")
    return match.group(1) if match else ""


def canonicalize_reddit_url(url: str, reddit_id: str = "", subreddit: str = "") -> str:
    if reddit_id:
        sub = subreddit.strip().strip("r/") or "unknown"
        return f"https://www.reddit.com/r/{sub}/comments/{reddit_id}/"
    if not url:
        return ""
    parsed = urllib.parse.urlparse(url if url.startswith("http") else "https://www.reddit.com" + url)
    path = re.sub(r"/+$", "/", parsed.path)
    return urllib.parse.urlunparse(("https", "www.reddit.com", path, "", "", ""))


def make_mention_id(
    *,
    source: str,
    reddit_id: str,
    canonical_url: str,
    title: str,
    text: str,
) -> str:
    if reddit_id:
        return f"reddit_submission_{reddit_id}"
    if canonical_url:
        return "url_" + _stable_hash(canonical_url)
    return "hash_" + _stable_hash(source, title, _normalize_text_for_hash(text))


def make_record(
    *,
    run_id: str,
    source: str,
    platform: str,
    sub_source: str,
    source_type: str,
    reddit_id: str,
    keyword: str,
    query: str,
    category: str,
    title: str,
    text: str,
    author: str,
    community: str,
    published_at: str,
    url: str,
    engagement_score: float = 0.0,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if text in ("[deleted]", "[removed]"):
        text = ""
    canonical_url = canonicalize_reddit_url(url, reddit_id=reddit_id, subreddit=community)
    mention_id = make_mention_id(
        source=source,
        reddit_id=reddit_id,
        canonical_url=canonical_url,
        title=title,
        text=text,
    )
    collected_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    full_text = f"{title} {text}".strip()
    return {
        "ingestion_run_id": run_id,
        "source": source,
        "platform": platform,
        "sub_source": sub_source,
        "source_type": source_type,
        "reddit_id": reddit_id,
        "source_record_id": reddit_id or canonical_url,
        "mention_id": mention_id,
        "canonical_url": canonical_url,
        "url": url,
        "keyword": keyword,
        "query": query,
        "category": category,
        "title": title,
        "text": text,
        "full_text": full_text,
        "author": author,
        "community": community,
        "published_at": published_at,
        "collected_at": collected_at,
        "event_date": iso_to_date(published_at),
        "ingestion_date": iso_to_date(collected_at),
        "engagement_score": float(engagement_score or 0.0),
        "semantic_relevance_score": 0.0,
        "tiktok_relevance_score": 0.0,
        "business_context_label": "",
        "collector_priority_score": 0.0,
        "metrics_json": json.dumps(metrics or {}, ensure_ascii=False),
    }


def subreddit_order() -> list[tuple[str, str]]:
    priority = [
        "creator_commerce",
        "deals_shopping_reviews",
        "beauty_skincare",
        "supplements_nutrition",
        "womens_fashion",
        "mens_fashion",
        "fashion_accessories",
    ]
    rows: list[tuple[str, str]] = []
    for cat in priority:
        rows.extend((cat, sub) for sub in SUBREDDIT_CATEGORIES.get(cat, []))
    for cat, subs in SUBREDDIT_CATEGORIES.items():
        if cat not in priority:
            rows.extend((cat, sub) for sub in subs)
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for cat, sub in rows:
        if sub not in seen:
            seen.add(sub)
            out.append((cat, sub))
    return out


def fetch_with_retries(
    session: requests.Session,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: int = 30,
    max_retries: int = 3,
) -> FetchResult:
    counters = {
        "http_200_count": 0,
        "http_429_count": 0,
        "http_403_count": 0,
        "http_404_count": 0,
        "timeout_count": 0,
        "error_count": 0,
    }
    last_type = ""
    last_msg = ""
    for attempt in range(max_retries + 1):
        try:
            resp = session.get(url, params=params, timeout=timeout)
            code = resp.status_code
            if code == 200:
                counters["http_200_count"] += 1
                return FetchResult(resp, "success", counters)
            if code == 429:
                counters["http_429_count"] += 1
                last_type, last_msg = "rate_limited", "HTTP 429"
                if attempt < max_retries:
                    sleep_sec = min(90, (2**attempt) * 5 + random.uniform(0, 3))
                    log.warning("Rate limited; retrying in %.1fs (%s)", sleep_sec, url)
                    time.sleep(sleep_sec)
                    continue
                return FetchResult(None, "rate_limited", counters, last_type, last_msg)
            if code == 403:
                counters["http_403_count"] += 1
                return FetchResult(None, "blocked_private", counters, "http_403", "HTTP 403")
            if code == 404:
                counters["http_404_count"] += 1
                return FetchResult(None, "not_found", counters, "http_404", "HTTP 404")
            if code >= 500 and attempt < max_retries:
                counters["error_count"] += 1
                last_type, last_msg = "server_error", f"HTTP {code}"
                sleep_sec = min(60, (2**attempt) * 3 + random.uniform(0, 2))
                log.warning("Server error %s; retrying in %.1fs (%s)", code, sleep_sec, url)
                time.sleep(sleep_sec)
                continue
            counters["error_count"] += 1
            return FetchResult(None, "http_error", counters, f"http_{code}", f"HTTP {code}")
        except requests.Timeout as exc:
            counters["timeout_count"] += 1
            last_type, last_msg = "timeout", str(exc)[:300]
        except requests.RequestException as exc:
            counters["error_count"] += 1
            last_type, last_msg = type(exc).__name__, str(exc)[:300]
        if attempt < max_retries:
            sleep_sec = min(60, (2**attempt) * 3 + random.uniform(0, 2))
            log.warning("%s while fetching; retrying in %.1fs (%s)", last_type, sleep_sec, url)
            time.sleep(sleep_sec)
    return FetchResult(None, "failed", counters, last_type, last_msg)


def new_audit(
    *,
    run_id: str,
    source: str,
    subreddit: str,
    sort: str,
    start_date: str,
    end_date: str,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        "run_id": run_id,
        "source": source,
        "subreddit": subreddit,
        "sort": sort,
        "window_start": start_date,
        "window_end": end_date,
        "pages_attempted": 0,
        "records_seen": 0,
        "records_new": 0,
        "records_duplicate": 0,
        "records_written": 0,
        "http_200_count": 0,
        "http_429_count": 0,
        "http_403_count": 0,
        "http_404_count": 0,
        "timeout_count": 0,
        "error_count": 0,
        "last_error_type": "",
        "last_error_message": "",
        "started_at": now.isoformat(),
        "finished_at": None,
        "duration_sec": None,
        "status": "started",
        "_started_dt": now,
    }


def finish_audit(row: dict[str, Any], status: str, error_type: str = "", error_message: str = "") -> dict[str, Any]:
    finished = datetime.now(timezone.utc)
    row["finished_at"] = finished.isoformat()
    row["duration_sec"] = round((finished - row.pop("_started_dt")).total_seconds(), 3)
    row["status"] = status
    if error_type:
        row["last_error_type"] = error_type
    if error_message:
        row["last_error_message"] = error_message[:500]
    return row


def merge_fetch_counters(audit: dict[str, Any], result: FetchResult) -> None:
    for key, value in result.counters.items():
        audit[key] += value
    if result.error_type:
        audit["last_error_type"] = result.error_type
        audit["last_error_message"] = result.error_message[:500]


def scrape_reddit_json(
    *,
    run_id: str,
    start_date: str,
    end_date: str,
    existing_ids: set[str],
    per_subreddit: int,
    sorts: list[str],
    max_pages_per_sort: int,
    request_delay: float,
    safety_cap: int,
    max_subreddits: int = 0,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    audits: list[dict[str, Any]] = []
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    subreddits = subreddit_order()
    if max_subreddits > 0:
        subreddits = subreddits[:max_subreddits]

    for category, subreddit in subreddits:
        if len(records) >= safety_cap:
            break
        sub_new = 0
        for sort in sorts:
            audit = new_audit(
                run_id=run_id,
                source="reddit_json",
                subreddit=subreddit,
                sort=sort,
                start_date=start_date,
                end_date=end_date,
            )
            after_token: str | None = None
            status = "success"
            for _ in range(max_pages_per_sort):
                if sub_new >= per_subreddit or len(records) >= safety_cap:
                    break
                url = f"{REDDIT_JSON_BASE}/r/{subreddit}/{sort}.json"
                params: dict[str, Any] = {"limit": 100}
                if sort == "top":
                    params["t"] = "week"
                if after_token:
                    params["after"] = after_token
                audit["pages_attempted"] += 1
                result = fetch_with_retries(session, url, params=params)
                merge_fetch_counters(audit, result)
                if result.response is None:
                    status = result.status
                    log.warning("reddit_json r/%s/%s stopped: %s %s", subreddit, sort, result.error_type, result.error_message)
                    break
                try:
                    data = result.response.json().get("data", {})
                except ValueError as exc:
                    audit["error_count"] += 1
                    status = "parse_error"
                    audit["last_error_type"] = "json_parse_error"
                    audit["last_error_message"] = str(exc)[:500]
                    log.warning("reddit_json r/%s/%s returned invalid JSON", subreddit, sort)
                    break
                children = data.get("children", [])
                after_token = data.get("after")
                if not children:
                    break
                for child in children:
                    post = child.get("data", {})
                    created = post.get("created_utc") or 0
                    published_at = datetime.fromtimestamp(created, tz=timezone.utc).isoformat() if created else ""
                    audit["records_seen"] += 1
                    if not _in_window(published_at, start_date, end_date):
                        continue
                    permalink = post.get("permalink", "") or ""
                    url_val = f"https://reddit.com{permalink}" if permalink else post.get("url", "")
                    reddit_id = parse_reddit_id(url_val, native_id=post.get("id"))
                    engagement = (post.get("score") or 0) + (post.get("num_comments") or 0) * 3
                    rec = make_record(
                        run_id=run_id,
                        source="reddit_json",
                        platform="reddit",
                        sub_source=f"r/{subreddit}",
                        source_type="submission",
                        reddit_id=reddit_id,
                        keyword=f"r/{subreddit}",
                        query=f"r/{subreddit} {sort}",
                        category=category,
                        title=post.get("title", "") or "",
                        text=post.get("selftext", "") or "",
                        author=post.get("author", "[deleted]"),
                        community=subreddit,
                        published_at=published_at,
                        url=url_val,
                        engagement_score=float(engagement),
                        metrics={
                            "score": post.get("score", 0),
                            "num_comments": post.get("num_comments", 0),
                            "upvote_ratio": post.get("upvote_ratio", 0),
                            "sort": sort,
                        },
                    )
                    if rec["mention_id"] in existing_ids:
                        audit["records_duplicate"] += 1
                        continue
                    existing_ids.add(rec["mention_id"])
                    records.append(rec)
                    audit["records_new"] += 1
                    audit["records_written"] += 1
                    sub_new += 1
                if not after_token or len(children) < 100:
                    break
                time.sleep(request_delay)
            audits.append(finish_audit(audit, status))
        if sub_new:
            log.info("reddit_json r/%s [%s]: +%d", subreddit, category, sub_new)
    return records, audits


def _rss_entries(root: ET.Element) -> list[ET.Element]:
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    return root.findall("atom:entry", ns) or root.findall(".//item")


def _entry_text(entry: ET.Element, name: str, ns: dict[str, str]) -> str:
    el = entry.find(f"atom:{name}", ns)
    if el is None:
        el = entry.find(name)
    return (el.text or "") if el is not None else ""


def scrape_reddit_rss(
    *,
    run_id: str,
    start_date: str,
    end_date: str,
    existing_ids: set[str],
    per_subreddit: int,
    sorts: list[str],
    request_delay: float,
    safety_cap: int,
    max_subreddits: int = 0,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    audits: list[dict[str, Any]] = []
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    subreddits = subreddit_order()
    if max_subreddits > 0:
        subreddits = subreddits[:max_subreddits]

    for category, subreddit in subreddits:
        if len(records) >= safety_cap:
            break
        sub_new = 0
        for sort in sorts:
            audit = new_audit(
                run_id=run_id,
                source="reddit_rss",
                subreddit=subreddit,
                sort=sort,
                start_date=start_date,
                end_date=end_date,
            )
            url = f"https://www.reddit.com/r/{subreddit}/{sort}/.rss?limit=100"
            audit["pages_attempted"] = 1
            result = fetch_with_retries(session, url, max_retries=3)
            merge_fetch_counters(audit, result)
            status = result.status
            if result.response is None:
                log.warning("reddit_rss r/%s/%s stopped: %s %s", subreddit, sort, result.error_type, result.error_message)
                audits.append(finish_audit(audit, status, result.error_type, result.error_message))
                continue
            try:
                root = ET.fromstring(result.response.content)
            except ET.ParseError as exc:
                audit["error_count"] += 1
                audits.append(finish_audit(audit, "parse_error", "xml_parse_error", str(exc)))
                continue
            for entry in _rss_entries(root)[:per_subreddit]:
                title = _entry_text(entry, "title", ns)
                text = _entry_text(entry, "content", ns) or _entry_text(entry, "description", ns)
                pub_raw = _entry_text(entry, "updated", ns) or _entry_text(entry, "pubDate", ns)
                link_el = entry.find("atom:link", ns)
                if link_el is None:
                    link_el = entry.find("link")
                url_val = (link_el.get("href") or link_el.text or "") if link_el is not None else ""
                author_el = entry.find("atom:author/atom:name", ns)
                author = (author_el.text or "") if author_el is not None else ""
                try:
                    pub_dt = parsedate_to_datetime(pub_raw) if "," in pub_raw else datetime.fromisoformat(pub_raw.replace("Z", "+00:00"))
                    if pub_dt.tzinfo is None:
                        pub_dt = pub_dt.replace(tzinfo=timezone.utc)
                    published_at = pub_dt.astimezone(timezone.utc).isoformat()
                except Exception:
                    published_at = pub_raw
                audit["records_seen"] += 1
                if not _in_window(published_at, start_date, end_date):
                    continue
                reddit_id = parse_reddit_id(url_val)
                rec = make_record(
                    run_id=run_id,
                    source="reddit_rss",
                    platform="reddit",
                    sub_source=f"r/{subreddit}",
                    source_type="submission",
                    reddit_id=reddit_id,
                    keyword=f"r/{subreddit}",
                    query=f"r/{subreddit} {sort}",
                    category=category,
                    title=title,
                    text=text,
                    author=author,
                    community=subreddit,
                    published_at=published_at,
                    url=url_val,
                    metrics={"sort": sort},
                )
                if rec["mention_id"] in existing_ids:
                    audit["records_duplicate"] += 1
                    continue
                existing_ids.add(rec["mention_id"])
                records.append(rec)
                audit["records_new"] += 1
                audit["records_written"] += 1
                sub_new += 1
                if sub_new >= per_subreddit or len(records) >= safety_cap:
                    break
            audits.append(finish_audit(audit, "success"))
            time.sleep(request_delay)
        if sub_new:
            log.info("reddit_rss r/%s [%s]: +%d", subreddit, category, sub_new)
    return records, audits


def scrape_reddit_arctic(
    *,
    run_id: str,
    start_date: str,
    end_date: str,
    existing_ids: set[str],
    per_subreddit: int,
    max_pages_per_sort: int,
    request_delay: float,
    safety_cap: int,
    max_subreddits: int = 0,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    audits: list[dict[str, Any]] = []
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    subreddits = subreddit_order()
    if max_subreddits > 0:
        subreddits = subreddits[:max_subreddits]

    for category, subreddit in subreddits:
        if len(records) >= safety_cap:
            break
        audit = new_audit(
            run_id=run_id,
            source="arctic_shift_reddit",
            subreddit=subreddit,
            sort="desc",
            start_date=start_date,
            end_date=end_date,
        )
        sub_new = 0
        before = end_date
        status = "success"
        for _ in range(max_pages_per_sort):
            if sub_new >= per_subreddit or len(records) >= safety_cap:
                break
            params = {
                "subreddit": subreddit,
                "limit": 100,
                "after": start_date,
                "before": before,
                "sort": "desc",
            }
            audit["pages_attempted"] += 1
            result = fetch_with_retries(session, f"{ARCTIC_SHIFT_BASE}/posts/search", params=params)
            merge_fetch_counters(audit, result)
            if result.response is None:
                status = result.status
                log.warning("arctic_shift r/%s stopped: %s %s", subreddit, result.error_type, result.error_message)
                break
            try:
                rows = result.response.json().get("data", [])
            except ValueError as exc:
                audit["error_count"] += 1
                status = "parse_error"
                audit["last_error_type"] = "json_parse_error"
                audit["last_error_message"] = str(exc)[:500]
                log.warning("arctic_shift r/%s returned invalid JSON", subreddit)
                break
            if not rows:
                break
            oldest_ts = None
            for row in rows:
                created = row.get("created_utc") or 0
                published_at = datetime.fromtimestamp(created, tz=timezone.utc).isoformat() if created else ""
                audit["records_seen"] += 1
                if not _in_window(published_at, start_date, end_date):
                    continue
                permalink = row.get("permalink", "") or ""
                url_val = f"https://reddit.com{permalink}" if permalink else ""
                reddit_id = parse_reddit_id(url_val, native_id=row.get("id"))
                engagement = (row.get("score") or 0) + (row.get("num_comments") or 0) * 3
                rec = make_record(
                    run_id=run_id,
                    source="arctic_shift_reddit",
                    platform="reddit",
                    sub_source=f"r/{subreddit}",
                    source_type="submission",
                    reddit_id=reddit_id,
                    keyword=f"r/{subreddit}",
                    query=f"r/{subreddit} {start_date}..{end_date}",
                    category=category,
                    title=row.get("title", "") or "",
                    text=(row.get("selftext", "") or "").strip(),
                    author=row.get("author", "[deleted]"),
                    community=subreddit,
                    published_at=published_at,
                    url=url_val,
                    engagement_score=float(engagement),
                    metrics={"score": row.get("score", 0), "num_comments": row.get("num_comments", 0)},
                )
                if rec["mention_id"] in existing_ids:
                    audit["records_duplicate"] += 1
                    continue
                existing_ids.add(rec["mention_id"])
                records.append(rec)
                audit["records_new"] += 1
                audit["records_written"] += 1
                sub_new += 1
                if oldest_ts is None or (created and created < oldest_ts):
                    oldest_ts = created
            if len(rows) < 100 or oldest_ts is None:
                break
            before = datetime.fromtimestamp(oldest_ts, tz=timezone.utc).strftime("%Y-%m-%d")
            time.sleep(request_delay)
        audits.append(finish_audit(audit, status))
        if sub_new:
            log.info("arctic_shift r/%s [%s]: +%d", subreddit, category, sub_new)
    return records, audits


def parse_sources(raw: str) -> set[str]:
    aliases = {"arctic": "arctic_shift_reddit", "rss": "reddit_rss"}
    out: set[str] = set()
    for item in raw.split(","):
        key = item.strip()
        if not key:
            continue
        out.add(aliases.get(key, key))
    return out


def update_states(state: dict[str, Any], audits: list[dict[str, Any]]) -> None:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in audits:
        key = (row["source"], row["subreddit"])
        cur = grouped.setdefault(
            key,
            {
                "new": 0,
                "status": "success",
                "error": "",
                "start": row["window_start"],
                "end": row["window_end"],
            },
        )
        cur["new"] += int(row.get("records_new") or 0)
        if row.get("status") not in {"success", "started"}:
            cur["status"] = row["status"]
            cur["error"] = row.get("last_error_message") or row.get("last_error_type") or ""
    for (source, subreddit), value in grouped.items():
        update_source_state(
            state,
            source=source,
            subreddit=subreddit,
            window_start=value["start"],
            window_end=value["end"],
            new_records=value["new"],
            status=value["status"],
            error=value["error"],
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Window-first Reddit scraper")
    parser.add_argument("--mode", choices=["daily-live", "weekly-backfill", "manual"], default="manual")
    parser.add_argument("--start", required=True, help="Event window start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="Event window end date, inclusive (YYYY-MM-DD)")
    parser.add_argument("--sources", default="reddit_json,rss", help="reddit_json,rss,arctic; hn/gnews are deprecated no-ops")
    parser.add_argument("--per-sub", type=int, default=100, help="Max new records per subreddit per source")
    parser.add_argument("--max-pages-per-sort", type=int, default=3, help="Max pages per subreddit/sort")
    parser.add_argument("--sorts", default="new,hot", help="Reddit JSON/RSS sorts. Daily default avoids top.")
    parser.add_argument("--delay", type=float, default=1.5, help="Delay between successful pages/feeds")
    parser.add_argument("--safety-cap", type=int, default=DEFAULT_SAFETY_CAP, help="Global max new records per run")
    parser.add_argument("--max-subreddits", type=int, default=0, help="Debug/smoke cap on subreddit count (0 = all)")
    parser.add_argument("--run-id", default="", help="Optional explicit run id")
    parser.add_argument("--refresh-legacy-csv", action="store_true", help="Refresh data/raw/scraped_2026_large.csv compatibility view")
    args = parser.parse_args()

    run_id = args.run_id or f"{args.mode}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    sources = parse_sources(args.sources)
    if "hn" in sources or "gnews" in sources:
        log.warning("HN/GNews sources are deprecated and disabled by default; ignoring this run.")
        sources -= {"hn", "gnews"}

    existing_ids = load_existing_mention_ids(RAW_DIR, LEGACY_CSV)
    state = load_json_state(STATE_FILE)
    all_records: list[dict[str, Any]] = []
    all_audits: list[dict[str, Any]] = []
    sorts = [s.strip() for s in args.sorts.split(",") if s.strip()]

    log.info(
        "Starting scrape run_id=%s mode=%s window=%s..%s sources=%s existing_ids=%d",
        run_id,
        args.mode,
        args.start,
        args.end,
        sorted(sources),
        len(existing_ids),
    )

    if "reddit_json" in sources:
        recs, audits = scrape_reddit_json(
            run_id=run_id,
            start_date=args.start,
            end_date=args.end,
            existing_ids=existing_ids,
            per_subreddit=args.per_sub,
            sorts=sorts,
            max_pages_per_sort=args.max_pages_per_sort,
            request_delay=args.delay,
            safety_cap=args.safety_cap,
            max_subreddits=args.max_subreddits,
        )
        all_records.extend(recs)
        all_audits.extend(audits)
        write_raw_parquet(records=recs, raw_dir=RAW_DIR, run_id=run_id, source="reddit_json", mode=args.mode, window_start=args.start)

    if "reddit_rss" in sources:
        recs, audits = scrape_reddit_rss(
            run_id=run_id,
            start_date=args.start,
            end_date=args.end,
            existing_ids=existing_ids,
            per_subreddit=args.per_sub,
            sorts=sorts,
            request_delay=max(args.delay, 2.0),
            safety_cap=args.safety_cap,
            max_subreddits=args.max_subreddits,
        )
        all_records.extend(recs)
        all_audits.extend(audits)
        write_raw_parquet(records=recs, raw_dir=RAW_DIR, run_id=run_id, source="reddit_rss", mode=args.mode, window_start=args.start)

    if "arctic_shift_reddit" in sources:
        recs, audits = scrape_reddit_arctic(
            run_id=run_id,
            start_date=args.start,
            end_date=args.end,
            existing_ids=existing_ids,
            per_subreddit=args.per_sub,
            max_pages_per_sort=args.max_pages_per_sort,
            request_delay=args.delay,
            safety_cap=args.safety_cap,
            max_subreddits=args.max_subreddits,
        )
        all_records.extend(recs)
        all_audits.extend(audits)
        write_raw_parquet(records=recs, raw_dir=RAW_DIR, run_id=run_id, source="arctic_shift_reddit", mode=args.mode, window_start=args.start)

    append_audit_rows(AUDIT_FILE, all_audits)
    update_states(state, all_audits)
    state["last_run"] = {
        "run_id": run_id,
        "mode": args.mode,
        "sources": sorted(sources),
        "window_start": args.start,
        "window_end": args.end,
        "records_new": len(all_records),
        "finished_at": utc_now_iso(),
    }
    save_json_state(STATE_FILE, state)

    if args.refresh_legacy_csv:
        rows = refresh_legacy_raw_csv(RAW_DIR, LEGACY_CSV)
        log.info("Refreshed legacy CSV compatibility view: %s (%d rows)", LEGACY_CSV, rows)

    log.info("SCRAPE COMPLETE run_id=%s new_records=%d audit=%s", run_id, len(all_records), AUDIT_FILE)


if __name__ == "__main__":
    main()
