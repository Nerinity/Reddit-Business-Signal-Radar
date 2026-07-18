#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import logging
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import ensure_parent, json_list, ngrams, word_tokens

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("tokenize_extract_phrases")

STOPWORDS = {
    "the", "and", "for", "with", "from", "this", "that", "have", "has", "had", "are",
    "was", "were", "you", "your", "they", "them", "our", "but", "can", "just", "about",
    "into", "like", "what", "when", "where", "there", "here", "would", "could", "should",
}
PROTECTED = {
    "not", "no", "never", "too", "very", "really", "so", "barely", "hardly", "without",
    "against", "love", "hate", "bad", "good", "great", "terrible", "amazing", "disappointed",
    "worth", "overrated", "underrated", "dupe", "return", "refund", "broken",
}


def spacy_process(texts: list[str]):
    try:
        import spacy  # type: ignore
        try:
            nlp = spacy.load("en_core_web_sm", disable=["ner"])
        except Exception:
            nlp = spacy.blank("en")
        return list(nlp.pipe(texts, batch_size=100))
    except Exception:
        return None


def process_chunk(chunk_df: pd.DataFrame) -> pd.DataFrame:
    texts = chunk_df["text_for_tokenization"].fillna("").astype(str).tolist()
    mention_ids = chunk_df["mention_id"].tolist()
    docs = spacy_process(texts)
    rows = []
    for i, text in enumerate(texts):
        toks = word_tokens(text)
        if docs is not None:
            doc = docs[i]
            lemmas = [getattr(t, "lemma_", "") or t.text.lower() for t in doc if t.text.strip()]
            try:
                noun_phrases = [chunk.text.lower() for chunk in doc.noun_chunks]
            except Exception:
                noun_phrases = [ng for ng in ngrams(toks, 2) if len(ng) > 3][:40]
        else:
            lemmas = toks
            noun_phrases = [ng for ng in ngrams(toks, 2) if len(ng) > 3][:40]
        no_stop = [t for t in toks if t not in STOPWORDS or t in PROTECTED]
        lem_no_stop = [t for t in lemmas if t not in STOPWORDS or t in PROTECTED]
        rows.append({
            "mention_id": mention_ids[i],
            "tokens": json_list(toks),
            "lemmas": json_list(lemmas),
            "tokens_no_stopwords": json_list(no_stop),
            "lemmas_no_stopwords": json_list(lem_no_stop),
            "noun_phrases": json_list(noun_phrases[:80]),
            "bigrams": json_list(ngrams(no_stop, 2)[:120]),
            "trigrams": json_list(ngrams(no_stop, 3)[:120]),
        })
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/processed/clean_reddit_posts.parquet")
    parser.add_argument("--output", default="data/processed/reddit_tokens.parquet")
    parser.add_argument("--sample", type=int, default=0)
    # spaCy docs + row dicts for the *entire* input held in memory at once was OOM-killing
    # this step on large runs (500k+ posts). Process and flush to disk in chunks instead so
    # peak memory stays bounded to one chunk's worth of spaCy Docs, not the whole dataset.
    parser.add_argument("--chunk-size", type=int, default=60_000)
    args = parser.parse_args()

    df = pd.read_parquet(args.input)
    if args.sample:
        df = df.head(args.sample).copy()
    total = len(df)

    out_path = Path(args.output)
    ensure_parent(out_path)
    parts_dir = out_path.parent / f"{out_path.stem}_parts_tmp"
    parts_dir.mkdir(parents=True, exist_ok=True)
    part_paths: list[Path] = []
    try:
        for start in range(0, total, args.chunk_size):
            end = min(start + args.chunk_size, total)
            chunk_out = process_chunk(df.iloc[start:end])
            part_path = parts_dir / f"part_{start:08d}.parquet"
            chunk_out.to_parquet(part_path, index=False)
            part_paths.append(part_path)
            log.info("Processed %d/%d posts (chunk %s-%s)", end, total, start, end)
            del chunk_out
            gc.collect()

        combined = pd.concat([pd.read_parquet(p) for p in part_paths], ignore_index=True) if part_paths else pd.DataFrame()
        combined.to_parquet(out_path, index=False)
        log.info("Wrote tokens for %d posts", len(combined))
    finally:
        for p in part_paths:
            p.unlink(missing_ok=True)
        try:
            parts_dir.rmdir()
        except OSError:
            pass


if __name__ == "__main__":
    main()
