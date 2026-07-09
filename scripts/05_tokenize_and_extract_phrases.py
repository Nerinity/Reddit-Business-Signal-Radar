#!/usr/bin/env python3
from __future__ import annotations

import argparse
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/processed/clean_reddit_posts.parquet")
    parser.add_argument("--output", default="data/processed/reddit_tokens.parquet")
    parser.add_argument("--sample", type=int, default=0)
    args = parser.parse_args()

    df = pd.read_parquet(args.input)
    if args.sample:
        df = df.head(args.sample).copy()
    texts = df["text_for_tokenization"].fillna("").astype(str).tolist()
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
            "mention_id": df.iloc[i]["mention_id"],
            "tokens": json_list(toks),
            "lemmas": json_list(lemmas),
            "tokens_no_stopwords": json_list(no_stop),
            "lemmas_no_stopwords": json_list(lem_no_stop),
            "noun_phrases": json_list(noun_phrases[:80]),
            "bigrams": json_list(ngrams(no_stop, 2)[:120]),
            "trigrams": json_list(ngrams(no_stop, 3)[:120]),
        })
    out = pd.DataFrame(rows)
    ensure_parent(Path(args.output))
    out.to_parquet(args.output, index=False)
    log.info("Wrote tokens for %d posts", len(out))


if __name__ == "__main__":
    main()
