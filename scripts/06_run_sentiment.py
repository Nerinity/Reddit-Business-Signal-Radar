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

from signal_radar.nlp.text_utils import ensure_parent, json_list

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("run_sentiment")

PHRASES = {
    "positive": ["love", "amazing", "great", "holy grail", "worth it", "recommend", "repurchase"],
    "negative": ["hate", "bad", "terrible", "broke", "broken", "disappointed", "overpriced", "scam", "regret", "waste of money"],
    "purchase_intent": ["buy", "bought", "ordered", "worth it", "recommend", "dupe", "alternative"],
    "complaint": ["returned", "refund", "broke", "doesn't work", "does not work", "waste of money"],
    "comparison": ["better than", " vs ", "compared to", "alternative to", "dupe for"],
    "viral": ["viral", "trending", "tiktok made me buy it", "everyone is talking about"],
}


def count_phrases(text: str, phrases: list[str]) -> tuple[int, list[str]]:
    low = text.lower()
    matched = [p for p in phrases if p in low]
    return len(matched), matched


def vader_scores(text: str) -> dict[str, float]:
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer  # type: ignore
        if not hasattr(vader_scores, "_sia"):
            vader_scores._sia = SentimentIntensityAnalyzer()  # type: ignore[attr-defined]
        sc = vader_scores._sia.polarity_scores(text)  # type: ignore[attr-defined]
        return {"compound": sc["compound"], "pos": sc["pos"], "neg": sc["neg"], "neu": sc["neu"]}
    except Exception:
        pos, _ = count_phrases(text, PHRASES["positive"])
        neg, _ = count_phrases(text, PHRASES["negative"])
        compound = max(min((pos - neg) / max(pos + neg, 1), 1), -1)
        return {"compound": compound, "pos": float(pos), "neg": float(neg), "neu": 1.0 if pos == neg == 0 else 0.0}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/processed/clean_reddit_posts.parquet")
    parser.add_argument("--output", default="data/processed/post_sentiment.parquet")
    parser.add_argument("--sample", type=int, default=0)
    args = parser.parse_args()

    df = pd.read_parquet(args.input)
    if args.sample:
        df = df.head(args.sample).copy()
    rows = []
    for row in df.itertuples(index=False):
        text = str(getattr(row, "text_for_sentiment", ""))
        scores = vader_scores(text)
        matched_all = []
        counts = {}
        for key, phrases in PHRASES.items():
            count, matched = count_phrases(text, phrases)
            counts[key] = count
            matched_all.extend(matched)
        comp = scores["compound"]
        label = "positive" if comp >= 0.05 else ("negative" if comp <= -0.05 else "neutral")
        rows.append({
            "mention_id": row.mention_id,
            "sentiment_compound": comp,
            "sentiment_pos": scores["pos"],
            "sentiment_neg": scores["neg"],
            "sentiment_neu": scores["neu"],
            "sentiment_label": label,
            "positive_word_count": counts["positive"],
            "negative_word_count": counts["negative"],
            "purchase_intent_count": counts["purchase_intent"],
            "complaint_count": counts["complaint"],
            "comparison_count": counts["comparison"],
            "viral_signal_count": counts["viral"],
            "matched_sentiment_phrases": json_list(sorted(set(matched_all))),
        })
    out = pd.DataFrame(rows)
    ensure_parent(Path(args.output))
    out.to_parquet(args.output, index=False)
    log.info("Wrote sentiment for %d posts", len(out))


if __name__ == "__main__":
    main()
