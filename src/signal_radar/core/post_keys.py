"""Shared Reddit post identity helpers for processed pipeline artifacts."""
from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit

import pandas as pd


POST_ID_COLUMNS = ("post_id", "reddit_post_id", "fullname", "id")
REDDIT_HOST_ALIASES = {
    "www.reddit.com": "reddit.com",
    "old.reddit.com": "reddit.com",
    "np.reddit.com": "reddit.com",
}


def normalize_reddit_url(value) -> str:
    if pd.isna(value):
        return ""
    text = str(value).strip()
    if not text:
        return ""
    try:
        parsed = urlsplit(text)
        host = REDDIT_HOST_ALIASES.get(parsed.netloc.casefold(), parsed.netloc.casefold())
        path = re.sub(r"/+", "/", parsed.path).rstrip("/")
        scheme = "https" if host.endswith("reddit.com") else parsed.scheme.casefold()
        return urlunsplit((scheme, host, path, "", ""))
    except ValueError:
        return text.rstrip("/")


def build_post_id(df: pd.DataFrame) -> pd.Series:
    key = pd.Series("", index=df.index, dtype="object")
    for column in POST_ID_COLUMNS:
        if column not in df.columns:
            continue
        missing = key.astype(str).str.strip().eq("")
        key.loc[missing] = df.loc[missing, column].fillna("").astype(str).str.strip()
    return key


def build_post_key(df: pd.DataFrame) -> pd.Series:
    key = build_post_id(df)
    if "url" in df.columns:
        missing = key.astype(str).str.strip().eq("")
        key.loc[missing] = df.loc[missing, "url"].map(normalize_reddit_url)
    return key
