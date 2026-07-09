#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import logging
from pathlib import Path
import sys

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.nlp.text_utils import ensure_parent, write_json

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("train_cluster_reranker")

FEATURE_COLUMNS = [
    "semantic_score",
    "keyword_overlap_score",
    "brand_prior_score",
    "same_parent_category",
    "candidate_rank",
    "inverse_candidate_rank",
    "cluster_product_count",
]


def split_by_query(df: pd.DataFrame, train_ratio: float, seed: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    query_ids = pd.Series(df["query_id"].astype(str).unique()).sample(frac=1.0, random_state=seed).tolist()
    split_at = max(1, int(len(query_ids) * train_ratio))
    if split_at >= len(query_ids) and len(query_ids) > 1:
        split_at = len(query_ids) - 1
    train_ids = set(query_ids[:split_at])
    train = df[df["query_id"].astype(str).isin(train_ids)].copy()
    valid = df[~df["query_id"].astype(str).isin(train_ids)].copy()
    if valid.empty:
        valid = train.copy()
    return train, valid


def ranking_metrics(valid: pd.DataFrame, score_col: str) -> dict:
    top1_hits = 0
    top3_hits = 0
    rr_values: list[float] = []
    ranks: list[int] = []
    query_count = 0
    for _, group in valid.groupby("query_id"):
        group = group.sort_values(score_col, ascending=False).reset_index(drop=True)
        positives = group.index[group["label"].astype(int).eq(1)].tolist()
        if not positives:
            continue
        query_count += 1
        rank = int(positives[0] + 1)
        ranks.append(rank)
        rr_values.append(1.0 / rank)
        top1_hits += int(rank == 1)
        top3_hits += int(rank <= 3)
    denom = max(query_count, 1)
    return {
        "top1_accuracy": float(top1_hits / denom),
        "top3_accuracy": float(top3_hits / denom),
        "mean_reciprocal_rank": float(np.mean(rr_values)) if rr_values else 0.0,
        "mean_positive_rank": float(np.mean(ranks)) if ranks else 0.0,
        "query_count": int(query_count),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the cluster reranker model.")
    parser.add_argument("--input", default="data/processed/reranker_training_pairs.parquet")
    parser.add_argument("--model-output", default="models/cluster_reranker.pkl")
    parser.add_argument("--report", default="data/processed/reranker_eval_report.json")
    parser.add_argument("--feature-importance", default="data/processed/reranker_feature_importance.csv")
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--random-seed", type=int, default=42)
    args = parser.parse_args()

    df = pd.read_parquet(args.input)
    missing = [col for col in FEATURE_COLUMNS + ["label", "query_id"] if col not in df.columns]
    if missing:
        raise ValueError(f"Training pairs missing required columns: {missing}")
    df = df.dropna(subset=["label"]).copy()
    for col in FEATURE_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)
    train, valid = split_by_query(df, args.train_ratio, args.random_seed)
    log.info("Training rows=%d validation rows=%d", len(train), len(valid))

    try:
        from xgboost import XGBClassifier  # type: ignore
        import joblib  # type: ignore
    except Exception as exc:
        raise RuntimeError("xgboost and joblib are required to train the cluster reranker") from exc

    model = XGBClassifier(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        eval_metric="logloss",
        random_state=args.random_seed,
    )
    model.fit(train[FEATURE_COLUMNS], train["label"].astype(int))
    valid = valid.copy()
    valid["predicted_probability"] = model.predict_proba(valid[FEATURE_COLUMNS])[:, 1]

    baseline = ranking_metrics(valid, "semantic_score")
    model_metrics = ranking_metrics(valid, "predicted_probability")
    report = {
        "train_rows": int(len(train)),
        "validation_rows": int(len(valid)),
        "train_query_count": int(train["query_id"].nunique()),
        "validation_query_count": int(valid["query_id"].nunique()),
        "feature_columns": FEATURE_COLUMNS,
        "baseline_semantic_top1_accuracy": baseline["top1_accuracy"],
        "model_top1_accuracy": model_metrics["top1_accuracy"],
        "model_top3_accuracy": model_metrics["top3_accuracy"],
        "mean_reciprocal_rank": model_metrics["mean_reciprocal_rank"],
        "mean_positive_rank": model_metrics["mean_positive_rank"],
        "baseline_metrics": baseline,
        "model_metrics": model_metrics,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    ensure_parent(Path(args.model_output))
    joblib.dump({"model": model, "feature_columns": FEATURE_COLUMNS}, args.model_output)
    write_json(Path(args.report), report)
    importance = pd.DataFrame({
        "feature": FEATURE_COLUMNS,
        "importance": model.feature_importances_,
    }).sort_values("importance", ascending=False)
    ensure_parent(Path(args.feature_importance))
    importance.to_csv(args.feature_importance, index=False)
    log.info("Wrote reranker model -> %s", args.model_output)


if __name__ == "__main__":
    main()
