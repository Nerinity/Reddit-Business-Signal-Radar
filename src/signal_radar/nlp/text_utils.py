"""Shared text cleaning and matching helpers for the NLP signal pipeline."""
from __future__ import annotations

import hashlib
import html
import json
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Iterable
from urllib.parse import quote_plus

import pandas as pd


URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
HTML_RE = re.compile(r"<[^>]+>")
MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
CODE_BLOCK_RE = re.compile(r"```.*?```", re.S)
INLINE_CODE_RE = re.compile(r"`([^`]+)`")
QUOTE_LINE_RE = re.compile(r"(?m)^\s*>.*$")
USER_RE = re.compile(r"\bu/[A-Za-z0-9_-]+\b")
SUB_RE = re.compile(r"\br/([A-Za-z0-9_]+)\b")
WS_RE = re.compile(r"\s+")
PUNCT_SPAM_RE = re.compile(r"([!?.,]){3,}")
EMOJI_SYMBOL_RE = re.compile(r"[\U00010000-\U0010ffff]", flags=re.UNICODE)
WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9'&+-]*")

DELETED_VALUES = {"[deleted]", "[removed]", "deleted", "removed", "nan", "none", "null"}
BOT_AUTHOR_RE = re.compile(r"bot$|automod|auto[_-]?moderator|moderator", re.I)
MEGATHREAD_RE = re.compile(r"\b(daily|weekly|monthly)\s+(discussion|megathread|thread)|megathread\b", re.I)
SPAM_TEMPLATE_RE = re.compile(r"\b(i am a bot|beep boop|automatically removed|message the moderators)\b", re.I)

GENERIC_KEYWORDS = {
    "product", "products", "item", "items", "new", "hot", "best", "other", "general",
    "misc", "miscellaneous", "sale", "seller", "shipping", "free", "quality",
}
NO_BRAND_VALUES = {
    "", "no brand", "nobrand", "generic", "unbranded", "unknown", "none", "n/a", "na",
    "not applicable", "no_brand", "null", "nan",
}
CORPORATE_SUFFIX_RE = re.compile(r"\b(inc|llc|ltd|limited|corp|corporation|co|company|official store|store)\b\.?", re.I)
TRADEMARK_RE = re.compile(r"[®™©]")


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def normalize_unicode(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    text = text.replace("’", "'").replace("‘", "'").replace("`", "'")
    text = text.replace("–", "-").replace("—", "-").replace("−", "-")
    return text


def strip_markup(text: str, *, preserve_subreddit_name: bool = True) -> str:
    text = normalize_unicode(text)
    text = html.unescape(text)
    text = CODE_BLOCK_RE.sub(" ", text)
    text = QUOTE_LINE_RE.sub(" ", text)
    text = MD_LINK_RE.sub(r"\1", text)
    text = INLINE_CODE_RE.sub(r"\1", text)
    text = HTML_RE.sub(" ", text)
    text = URL_RE.sub(" ", text)
    text = USER_RE.sub(" ", text)
    if preserve_subreddit_name:
        text = SUB_RE.sub(r"\1", text)
    else:
        text = SUB_RE.sub(" ", text)
    text = EMOJI_SYMBOL_RE.sub(" ", text)
    text = PUNCT_SPAM_RE.sub(r"\1", text)
    text = WS_RE.sub(" ", text).strip()
    return text


def clean_readable_text(text: object) -> str:
    return strip_markup(normalize_unicode(text))


def clean_token_text(text: object) -> str:
    text = clean_readable_text(text).lower()
    text = re.sub(r"[^a-z0-9\s'&+-]", " ", text)
    return WS_RE.sub(" ", text).strip()


def content_hash(*parts: object) -> str:
    joined = " ".join(clean_token_text(p) for p in parts if p is not None)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:24]


def normalize_brand(value: object) -> str:
    text = normalize_unicode(value).strip()
    text = TRADEMARK_RE.sub("", text)
    text = re.sub(r"\([^)]*\)", " ", text)
    text = CORPORATE_SUFFIX_RE.sub(" ", text)
    text = re.sub(r"[^A-Za-z0-9&'+\-\s]", " ", text)
    text = WS_RE.sub(" ", text).strip().lower()
    if text in NO_BRAND_VALUES:
        return ""
    return text


def brand_display(value: object) -> str:
    text = normalize_unicode(value).strip()
    text = TRADEMARK_RE.sub("", text)
    text = WS_RE.sub(" ", text).strip()
    return "" if normalize_brand(text) == "" else text


def split_keywords(value: object) -> list[str]:
    text = clean_token_text(value)
    if not text:
        return []
    parts = re.split(r"\s*(?:,|\||/|;|&|\band\b)\s*", text)
    out: list[str] = []
    seen: set[str] = set()
    for part in parts:
        part = WS_RE.sub(" ", part).strip()
        if not part or part in seen or part in GENERIC_KEYWORDS:
            continue
        if part.isdigit() or len(part) < 3:
            continue
        seen.add(part)
        out.append(part)
    return out


def json_list(values: Iterable[object], limit: int | None = None) -> str:
    vals = [str(v) for v in values if str(v).strip()]
    if limit:
        vals = vals[:limit]
    return json.dumps(vals, ensure_ascii=False)


def parse_json_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    text = normalize_unicode(value)
    if not text:
        return []
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return [str(v) for v in data]
    except Exception:
        pass
    return [v.strip() for v in re.split(r"[,|;]", text) if v.strip()]


def safe_read_table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".parquet":
        return pd.read_parquet(path)
    return pd.read_csv(path)


def write_json(path: Path, payload: dict) -> None:
    ensure_parent(path)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def top_counts(values: Iterable[object], n: int = 20) -> list[dict[str, object]]:
    counter = Counter(str(v) for v in values if str(v).strip())
    return [{"value": k, "count": int(v)} for k, v in counter.most_common(n)]


def google_brand_url(display: str) -> str:
    return "https://www.google.com/search?q=" + quote_plus(f"{display} brand")


def simple_language(text: str) -> str:
    sample = text[:1200]
    letters = re.findall(r"[A-Za-z]", sample)
    if not sample.strip():
        return "unknown"
    ascii_ratio = len(letters) / max(len(re.findall(r"\w", sample)), 1)
    common = len(re.findall(r"\b(the|and|is|it|this|that|for|with|not|you|my|i|to|of|in)\b", sample.lower()))
    if ascii_ratio > 0.55 or common >= 2:
        return "en"
    return "unknown"


def detect_language(text: str) -> str:
    try:
        from langdetect import detect  # type: ignore
        return detect(text)
    except Exception:
        pass
    try:
        import langid  # type: ignore
        return langid.classify(text)[0]
    except Exception:
        return simple_language(text)


def word_tokens(text: str) -> list[str]:
    return [m.group(0).lower() for m in WORD_RE.finditer(text or "")]


def ngrams(tokens: list[str], n: int) -> list[str]:
    return [" ".join(tokens[i : i + n]) for i in range(0, max(len(tokens) - n + 1, 0))]


def context_window(text: str, start: int, end: int, width: int = 80) -> str:
    return text[max(0, start - width) : min(len(text), end + width)].strip()
