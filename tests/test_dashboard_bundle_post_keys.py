import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))

from signal_radar.core.post_keys import build_post_key


def test_post_counts_use_url_instead_of_mention_id():
    rows = pd.DataFrame(
        {
            "mention_id": ["mention-1", "mention-2", "mention-3", "mention-4"],
            "url": [
                "https://reddit.com/r/test/comments/abc/a_post/?utm_source=x",
                "https://reddit.com/r/test/comments/abc/a_post/",
                "https://reddit.com/r/test/comments/abc/a_post",
                "https://reddit.com/r/test/comments/abc/a_post#comment",
            ],
            "cluster_id": ["cluster-1"] * 4,
            "brand_norm": ["brand-a", "brand-b", "brand-a", "brand-a"],
        }
    )
    rows["post_key"] = build_post_key(rows)

    assert rows["post_key"].nunique() == 1
    assert rows.groupby("brand_norm")["post_key"].nunique().to_dict() == {
        "brand-a": 1,
        "brand-b": 1,
    }
    assert rows.groupby(["cluster_id", "brand_norm"])["post_key"].nunique().to_dict() == {
        ("cluster-1", "brand-a"): 1,
        ("cluster-1", "brand-b"): 1,
    }
    assert len(rows[rows["brand_norm"].eq("brand-a")]) == 3


def test_post_id_takes_priority_when_present():
    rows = pd.DataFrame(
        {
            "post_id": ["post-1", "", None],
            "url": ["https://reddit.com/one", "https://reddit.com/two/", "https://reddit.com/three"],
        }
    )

    assert build_post_key(rows).tolist() == [
        "post-1",
        "https://reddit.com/two",
        "https://reddit.com/three",
    ]


def test_reddit_host_aliases_and_query_variants_share_one_key():
    rows = pd.DataFrame({"url": [
        "https://www.reddit.com/r/test/comments/abc/post/?utm_source=x",
        "http://old.reddit.com/r/test/comments/abc/post#fragment",
        "https://np.reddit.com/r/test/comments/abc/post/",
    ], "mention_id": ["mention-a", "mention-b", "mention-c"]})
    assert build_post_key(rows).nunique() == 1
