#!/usr/bin/env python3
from __future__ import annotations

import argparse
import logging
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import (
    clean_token_text,
    context_window,
    ensure_parent,
    google_brand_url,
    normalize_match_text,
    normalize_brand,
    parse_json_list,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("extract_entities")

BRAND_CONTEXT_RE = re.compile(
    r"\b(bought|ordered|recommend|recommended|worth it|vs|dupe|alternative|broke|returned|review|from|brand)\b",
    re.I,
)
ALLCAPS_RE = re.compile(r"\b[A-Z][A-Z0-9&+-]{1,10}\b")
CAMEL_RE = re.compile(r"\b[A-Z][a-z]+[A-Z][A-Za-z0-9]+\b")
TITLE_PHRASE_RE = re.compile(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2}\b")
QUOTE_RE = re.compile(r"['\"]([^'\"]{3,40})['\"]")

NEED_STATES = [
    "worth it", "dupe", "alternative", "under desk", "sensitive skin", "travel friendly",
    "budget option", "cheap", "expensive", "overrated", "underrated", "holy grail",
]
INGREDIENT_HINTS = [
    "silicone", "stainless steel", "ceramic", "spf", "retinol", "niacinamide", "castor oil",
    "cotton", "wool", "leather", "uv", "led",
]
RETAILERS = ["amazon", "target", "walmart", "costco", "sephora", "ulta", "temu", "aliexpress"]
SHORT_ALIAS_ALLOWLIST = {"3m", "lg", "hp", "dy"}
GENERIC_ENTITY_TERMS = {
    "the", "and", "for", "with", "from", "this", "that", "product", "item", "new",
    "hot", "best", "sale", "free", "shipping", "quality", "good", "bad", "great",
}
SENTIMENT_ONLY = {"love", "hate", "bad", "good", "great", "terrible", "amazing", "disappointed"}


def find_case_insensitive(text: str, phrase: str):
    return re.finditer(re.escape(phrase), text, flags=re.I)


def find_alias_matches(text_original: str, text_norm: str, alias_text: str, alias_norm: str):
    alias_match_norm = normalize_match_text(alias_text or alias_norm)
    if len(alias_match_norm.replace(" ", "")) < 3 and alias_match_norm not in SHORT_ALIAS_ALLOWLIST:
        return []
    matches = []
    if alias_text:
        flexible = r"[\W_]+".join(re.escape(p) for p in normalize_match_text(alias_text).split())
        if flexible:
            for match in re.finditer(rf"(?<![A-Za-z0-9]){flexible}(?![A-Za-z0-9])", text_original, flags=re.I):
                matches.append((match.start(), match.end(), match.group(0)))
    norm_pattern = rf"(?<![a-z0-9]){re.escape(alias_match_norm)}(?![a-z0-9])"
    if re.search(norm_pattern, text_norm):
        if not matches:
            # Normalized-only matches are still useful for accented or punctuated brands. Char
            # offsets are approximate in that case, so downstream uses the context fallback.
            matches.append((-1, -1, alias_text or alias_norm))
    return matches


def add_entity(rows: list[dict], *, post, text: str, entity_text: str, entity_type: str, confidence: float,
               source: str, is_brand: bool = False, in_platform_brand: bool = False,
               brand_display: str = "", brand_norm: str = "", start: int = -1, end: int = -1,
               review_status: str = "approved", cluster_id: str = "", cluster_name: str = "",
               related_cluster_ids: str = "[]") -> None:
    if not entity_text.strip():
        return
    if start < 0:
        idx = text.lower().find(entity_text.lower())
        start = idx
        end = idx + len(entity_text) if idx >= 0 else -1
    rows.append({
        "mention_id": post.mention_id,
        "entity_text": entity_text.strip(),
        "entity_norm": clean_token_text(entity_text),
        "entity_type": entity_type,
        "is_brand": bool(is_brand),
        "in_platform_brand": bool(in_platform_brand),
        "brand_display": brand_display,
        "brand_norm": brand_norm,
        "confidence": float(confidence),
        "source": source,
        "context_window": context_window(text, start, end) if start >= 0 else text[:180],
        "matched_cluster_id": cluster_id,
        "matched_cluster_name": cluster_name,
        "related_cluster_ids": related_cluster_ids,
        "start_char": int(start),
        "end_char": int(end),
        "review_status": review_status,
        "google_search_url": google_brand_url(brand_display or entity_text) if is_brand else "",
    })


def load_cluster_terms(path: Path) -> dict[str, tuple[str, str]]:
    if not path.exists():
        return {}
    df = pd.read_parquet(path)
    out = {}
    for row in df.itertuples(index=False):
        for field in ["leaf_keywords_top", "top_product_terms", "top_product_phrases"]:
            for term in parse_json_list(getattr(row, field, "")):
                out[clean_token_text(term)] = (str(row.cluster_id), str(row.cluster_name))
    return out


def useful_phrase(phrase: str, emitted_brand_norms: set[str]) -> bool:
    norm = clean_token_text(phrase)
    if len(norm) < 4 or not any(ch.isalpha() for ch in norm):
        return False
    parts = norm.split()
    if not parts or all(p in GENERIC_ENTITY_TERMS for p in parts):
        return False
    if norm in emitted_brand_norms:
        return False
    if norm in SENTIMENT_ONLY:
        return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--posts", default="data/processed/clean_reddit_posts.parquet")
    parser.add_argument("--brands", default="data/processed/brand_registry.parquet")
    parser.add_argument("--aliases", default="data/processed/brand_alias_lookup.parquet")
    parser.add_argument("--clusters", default="data/processed/cluster_profiles_226.parquet")
    parser.add_argument("--tokens", default="data/processed/reddit_tokens.parquet")
    parser.add_argument("--output", default="data/processed/entity_mentions.parquet")
    parser.add_argument("--review-output", default="data/processed/entity_review_queue.csv")
    parser.add_argument("--sample", type=int, default=0)
    args = parser.parse_args()

    posts = pd.read_parquet(args.posts)
    if args.sample:
        posts = posts.head(args.sample).copy()
    brand_df = pd.read_parquet(args.brands) if Path(args.brands).exists() else pd.DataFrame()
    alias_df = pd.read_parquet(args.aliases) if Path(args.aliases).exists() else pd.DataFrame()
    tokens = pd.read_parquet(args.tokens) if Path(args.tokens).exists() else pd.DataFrame()
    token_map = {r.mention_id: r for r in tokens.itertuples(index=False)} if len(tokens) else {}
    cluster_terms = load_cluster_terms(Path(args.clusters))

    alias_entries = []
    brand_meta = {}
    if len(alias_df):
        for r in alias_df.itertuples(index=False):
            alias_entries.append({
                "alias_norm": str(r.alias_norm),
                "alias_text": str(getattr(r, "alias_text", "") or getattr(r, "brand_display", "")),
                "brand_norm": str(r.brand_norm),
                "brand_display": str(r.brand_display),
                "source": "whitelist" if str(r.alias_norm) == str(r.brand_norm) else "alias",
            })
    if len(brand_df):
        for r in brand_df.itertuples(index=False):
            alias_entries.append({
                "alias_norm": str(r.brand_norm),
                "alias_text": str(r.brand_display),
                "brand_norm": str(r.brand_norm),
                "brand_display": str(r.brand_display),
                "source": "whitelist",
            })
            brand_meta[str(r.brand_norm)] = (
                str(getattr(r, "primary_cluster_id", "") or ""),
                str(getattr(r, "primary_cluster_name", "") or ""),
                str(getattr(r, "related_cluster_ids", "[]") or "[]"),
            )
    seen_aliases = set()
    deduped_alias_entries = []
    for entry in alias_entries:
        key = (entry["alias_norm"], entry["brand_norm"])
        if key not in seen_aliases:
            seen_aliases.add(key)
            deduped_alias_entries.append(entry)
    alias_entries = deduped_alias_entries
    alias_norms = {entry["alias_norm"] for entry in alias_entries}

    rows: list[dict] = []
    review_rows: list[dict] = []
    for post in posts.itertuples(index=False):
        text = str(getattr(post, "text_for_brand_matching", ""))
        token_text = clean_token_text(text)
        match_text = normalize_match_text(text)
        emitted_brand_norms: set[str] = set()

        for entry in alias_entries:
            alias_norm = entry["alias_norm"]
            if not alias_norm:
                continue
            for start, end, matched_text in find_alias_matches(text, match_text, entry["alias_text"], alias_norm):
                bnorm = entry["brand_norm"]
                cid, cname, related = brand_meta.get(bnorm, ("", "", "[]"))
                add_entity(rows, post=post, text=text, entity_text=matched_text, entity_type="brand",
                           is_brand=True, in_platform_brand=True, brand_display=entry["brand_display"], brand_norm=bnorm,
                           confidence=1.0, source=entry["source"], start=start, end=end,
                           cluster_id=cid, cluster_name=cname, related_cluster_ids=related)
                emitted_brand_norms.add(clean_token_text(matched_text))
                break

        # Product/category phrases from token outputs.
        tok = token_map.get(post.mention_id)
        phrases = []
        if tok is not None:
            for field in ["noun_phrases", "bigrams", "trigrams"]:
                phrases.extend(parse_json_list(getattr(tok, field, "")))
        for phrase in list(dict.fromkeys(phrases))[:80]:
            norm = clean_token_text(phrase)
            if not useful_phrase(phrase, emitted_brand_norms):
                continue
            cid, cname = cluster_terms.get(norm, ("", ""))
            etype = "category_keyword" if cid else "product_phrase"
            add_entity(rows, post=post, text=text, entity_text=phrase, entity_type=etype,
                       confidence=0.65 if cid else 0.45, source="tokens", cluster_id=cid, cluster_name=cname)

        for phrase in NEED_STATES:
            if phrase in token_text:
                add_entity(rows, post=post, text=text, entity_text=phrase, entity_type="need_state",
                           confidence=0.8, source="need_state_rules")
        for phrase in INGREDIENT_HINTS:
            if phrase in token_text:
                add_entity(rows, post=post, text=text, entity_text=phrase, entity_type="ingredient_material",
                           confidence=0.75, source="material_rules")
        for phrase in RETAILERS:
            if phrase in token_text:
                add_entity(rows, post=post, text=text, entity_text=phrase, entity_type="retailer_channel",
                           confidence=0.85, source="retailer_rules")

        # Regex brand candidates for review.
        for regex, source in [(ALLCAPS_RE, "regex_allcaps"), (CAMEL_RE, "regex_camel"), (TITLE_PHRASE_RE, "regex_title"), (QUOTE_RE, "regex_quote")]:
            for m in regex.finditer(text):
                raw = m.group(1) if regex is QUOTE_RE else m.group(0)
                norm = normalize_brand(raw)
                if not norm or norm in alias_norms or len(norm) < 3:
                    continue
                ctx = context_window(text, m.start(), m.end())
                if BRAND_CONTEXT_RE.search(ctx):
                    add_entity(rows, post=post, text=text, entity_text=raw, entity_type="unknown_candidate",
                               is_brand=False, confidence=0.45, source=source, start=m.start(), end=m.end(),
                               review_status="candidate")
                    review_rows.append({
                        "mention_id": post.mention_id, "entity_text": raw, "entity_norm": norm,
                        "source": source, "context_window": ctx, "review_status": "candidate",
                    })

    out = pd.DataFrame(rows).drop_duplicates(["mention_id", "entity_norm", "entity_type", "source"])
    ensure_parent(Path(args.output))
    out.to_parquet(args.output, index=False)
    pd.DataFrame(review_rows).drop_duplicates().to_csv(args.review_output, index=False)
    log.info("Wrote %d entity mentions and %d review rows", len(out), len(review_rows))


if __name__ == "__main__":
    main()
