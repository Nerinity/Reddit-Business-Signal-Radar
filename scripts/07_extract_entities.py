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
WORD_BOUNDARY_RE = re.compile(r"[A-Za-z0-9'&+\-]+")
ALLCAPS_RE = re.compile(r"\b[A-Z][A-Z0-9&+-]{1,10}\b")
CAMEL_RE = re.compile(r"\b[A-Z][a-z]+[A-Z][A-Za-z0-9]+\b")
# TITLE_PHRASE_RE requires at least two consecutive capitalized words (e.g. "Louis Vuitton
# Keepall"). A single title-case word is far too weak a signal on its own -- it matches any
# capitalized common noun -- so it is deliberately excluded here (see the single-word guard
# below, which also applies to QUOTE_RE for the same reason). ALLCAPS_RE and CAMEL_RE remain
# valid as single tokens because that casing pattern is itself a strong brand-like signal.
TITLE_PHRASE_RE = re.compile(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2}\b")
QUOTE_RE = re.compile(r"['\"]([^'\"]{3,40})['\"]")
WEAK_SINGLE_WORD_SOURCES = {"regex_title", "regex_quote"}

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
# spaCy's noun_chunks grammatically includes bare pronouns/quantifiers ("what", "they",
# "something", "anyone") as one-word noun phrases. They parse correctly but carry zero
# product/topic signal, so useful_phrase() drops any phrase made up only of these.
PRONOUN_ENTITY_TERMS = {
    "i", "me", "my", "mine", "myself", "we", "us", "our", "ours", "ourselves",
    "you", "your", "yours", "yourself", "yourselves", "you guys",
    "he", "him", "his", "himself", "she", "her", "hers", "herself",
    "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
    "who", "whom", "whose", "whoever", "whichever", "what", "whatever", "which",
    "this", "that", "these", "those",
    "anyone", "anybody", "anything", "someone", "somebody", "something",
    "everyone", "everybody", "everything", "no one", "nobody", "nothing",
    "some", "any", "all", "none", "both", "either", "neither", "other", "others",
}


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


def match_catalog_ngrams(text: str, catalog_norm_to_display: dict[str, str], skip_norms: set[str], max_n: int = 3):
    """Hash-lookup matcher for the full-domain catalog (tens of thousands of brands).

    The whitelist path above can afford a per-alias regex scan because it only has a few
    hundred entries. At catalog scale that would mean tens of thousands of regex scans per
    post, so instead this tokenizes the post once and checks each 1-3 word window against a
    brand_norm hash set -- O(text length) per post rather than O(brand count x text length).
    Longest windows are matched first and claim their tokens so "Louis Vuitton" doesn't also
    fire separate single-word matches on "Louis" and "Vuitton" if both happen to be in the catalog.
    """
    tokens = list(WORD_BOUNDARY_RE.finditer(text))
    n_tokens = len(tokens)
    claimed = [False] * n_tokens
    matches = []
    for n in range(max_n, 0, -1):
        for i in range(n_tokens - n + 1):
            if any(claimed[i:i + n]):
                continue
            start = tokens[i].start()
            end = tokens[i + n - 1].end()
            span_text = text[start:end]
            span_norm = normalize_brand(span_text)
            if not span_norm or len(span_norm) < 3 or span_norm in skip_norms:
                continue
            display = catalog_norm_to_display.get(span_norm)
            if display:
                matches.append((start, end, span_text, span_norm, display))
                for k in range(i, i + n):
                    claimed[k] = True
    return matches


def add_entity(rows: list[dict], *, post, text: str, entity_text: str, entity_type: str, confidence: float,
               source: str, is_brand: bool = False, in_platform_brand: bool = False,
               brand_display: str = "", brand_norm: str = "", start: int = -1, end: int = -1,
               review_status: str = "approved", cluster_id: str = "", cluster_name: str = "",
               related_cluster_ids: str = "[]", brand_signal_type: str = "") -> None:
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
        "brand_signal_type": brand_signal_type,
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
    if norm in PRONOUN_ENTITY_TERMS or all(p in PRONOUN_ENTITY_TERMS for p in parts):
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

    # brand_registry.parquet distinguishes three confidence tiers:
    #   is_whitelist_brand=True                  -> confirmed_whitelist_brand (matched via the
    #                                                small, regex-based alias_entries path below)
    #   is_catalog_brand=True, is_whitelist=False -> catalog_known_brand (matched via the
    #                                                hash-lookup n-gram path -- the catalog is
    #                                                tens of thousands of brands, too many for a
    #                                                per-brand regex scan per post)
    #   neither                                   -> not in the registry at all; regex/context
    #                                                candidates become unknown_candidate instead
    whitelist_brand_norms: set[str] = set()
    catalog_norm_to_display: dict[str, str] = {}
    brand_meta: dict[str, tuple[str, str, str]] = {}
    if len(brand_df):
        for r in brand_df.itertuples(index=False):
            bnorm = str(r.brand_norm)
            brand_meta[bnorm] = (
                str(getattr(r, "primary_cluster_id", "") or ""),
                str(getattr(r, "primary_cluster_name", "") or ""),
                str(getattr(r, "related_cluster_ids", "[]") or "[]"),
            )
            if bool(getattr(r, "is_whitelist_brand", False)):
                whitelist_brand_norms.add(bnorm)
            elif bool(getattr(r, "is_catalog_brand", False)):
                catalog_norm_to_display[bnorm] = str(r.brand_display)
    known_brand_norms = whitelist_brand_norms | set(catalog_norm_to_display)

    alias_entries = []
    if len(alias_df):
        for r in alias_df.itertuples(index=False):
            bnorm = str(r.brand_norm)
            if bnorm not in whitelist_brand_norms:
                continue  # catalog-only aliases are matched via the n-gram path, not regex
            alias_entries.append({
                "alias_norm": str(r.alias_norm),
                "alias_text": str(getattr(r, "alias_text", "") or getattr(r, "brand_display", "")),
                "brand_norm": bnorm,
                "brand_display": str(r.brand_display),
            })
    seen_aliases = set()
    deduped_alias_entries = []
    for entry in alias_entries:
        key = (entry["alias_norm"], entry["brand_norm"])
        if key not in seen_aliases:
            seen_aliases.add(key)
            deduped_alias_entries.append(entry)
    alias_entries = deduped_alias_entries

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
                           confidence=1.0, source="whitelist", start=start, end=end,
                           review_status="approved", brand_signal_type="confirmed_whitelist_brand",
                           cluster_id=cid, cluster_name=cname, related_cluster_ids=related)
                # Two forms so both the n-gram matcher below (normalize_brand-keyed) and
                # useful_phrase() further down (clean_token_text-keyed) dedupe correctly.
                emitted_brand_norms.add(bnorm)
                emitted_brand_norms.add(clean_token_text(matched_text))
                break

        # Full-domain catalog brands: hash-lookup n-gram match, lower confidence than whitelist,
        # never merged into confirmed_whitelist_brand. The 100k-row catalog is far too large to
        # hand-curate a denylist for (unlike the 500-row whitelist), and it turns out to contain
        # huge amounts of plain English words as "brand_name" rows ("Make", "cookies", "this",
        # "and", ...). A single-word catalog hit is therefore only kept when it has the same kind
        # of purchase/brand context the regex candidate path already requires; multi-word hits
        # are far less likely to coincide by chance and are kept as-is.
        for start, end, span_text, span_norm, display in match_catalog_ngrams(
            text, catalog_norm_to_display, skip_norms=emitted_brand_norms,
        ):
            if " " not in span_text.strip() and not BRAND_CONTEXT_RE.search(context_window(text, start, end)):
                continue
            cid, cname, related = brand_meta.get(span_norm, ("", "", "[]"))
            add_entity(rows, post=post, text=text, entity_text=span_text, entity_type="brand",
                       is_brand=True, in_platform_brand=True, brand_display=display, brand_norm=span_norm,
                       confidence=0.85, source="catalog", start=start, end=end,
                       review_status="catalog_observed", brand_signal_type="catalog_known_brand",
                       cluster_id=cid, cluster_name=cname, related_cluster_ids=related)
            emitted_brand_norms.add(span_norm)
            emitted_brand_norms.add(clean_token_text(span_text))

        # Product/category phrases from token outputs. noun_phrases is the primary source: with a
        # real spaCy model it holds genuine noun-chunk spans ("brown leather", "weird noise");
        # only when spaCy itself degraded to a blank pipeline does 05_tokenize_and_extract_phrases.py
        # fall back to raw bigrams there. bigrams/trigrams here are a second-line fallback for posts
        # where noun_phrases came back empty (e.g. no noun chunks found) rather than being blended in
        # wholesale, since blending in raw stopword-token n-grams alongside good noun phrases drowns
        # the signal in "i am" / "a lot" / "so i" style filler.
        tok = token_map.get(post.mention_id)
        phrases = []
        if tok is not None:
            phrases.extend(parse_json_list(getattr(tok, "noun_phrases", "")))
            if not phrases:
                for field in ["bigrams", "trigrams"]:
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
                if not norm or norm in known_brand_norms or len(norm) < 3:
                    continue
                if source in WEAK_SINGLE_WORD_SOURCES and " " not in raw.strip():
                    continue
                ctx = context_window(text, m.start(), m.end())
                if BRAND_CONTEXT_RE.search(ctx):
                    add_entity(rows, post=post, text=text, entity_text=raw, entity_type="unknown_candidate",
                               is_brand=False, confidence=0.45, source=source, start=m.start(), end=m.end(),
                               review_status="candidate", brand_signal_type="candidate_non_whitelist_brand")
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
