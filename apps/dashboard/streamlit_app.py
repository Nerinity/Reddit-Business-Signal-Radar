from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote_plus

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st


APP_DIR = Path(__file__).resolve().parents[2]
DEFAULT_BUNDLE = APP_DIR / "apps" / "web" / "public" / "data" / "dashboard.json"

SCORE_OPTIONS = {
    "Overall": "trend_score",
    "Momentum": "momentum_score",
    "Sentiment": "sentiment_score",
    "Reach": "cross_community_score",
    "Engagement": "engagement_score",
}


st.set_page_config(
    page_title="Reddit Product Trend Radar",
    page_icon="r/",
    layout="wide",
)

st.markdown(
    """
    <style>
      .block-container { padding-top: 1.2rem; padding-bottom: 2.5rem; }
      div[data-testid="stMetric"] {
        border: 1px solid rgba(20, 241, 255, 0.18);
        border-radius: 8px;
        padding: 14px 16px;
        background: linear-gradient(180deg, rgba(11, 23, 38, 0.72), rgba(4, 11, 20, 0.86));
      }
      .signal-card {
        border: 1px solid rgba(148, 214, 255, 0.16);
        border-radius: 8px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.035);
      }
      .small-muted { color: #8da4b7; font-size: 0.88rem; }
      .stars { color: #ffb629; letter-spacing: 1px; white-space: nowrap; }
    </style>
    """,
    unsafe_allow_html=True,
)


def star_rating(value: float | int | str | None) -> str:
    try:
        score = max(0.0, min(5.0, float(value or 0)))
    except (TypeError, ValueError):
        score = 0.0
    full = round(score)
    return "★" * full + "☆" * (5 - full)


@st.cache_data(show_spinner=False)
def load_bundle(path: str) -> dict:
    bundle_path = Path(path).expanduser()
    with bundle_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows or [])


def cluster_posts(posts: pd.DataFrame, cluster_id: str) -> pd.DataFrame:
    if posts.empty:
        return posts
    return posts[posts["cluster_id"].astype(str).eq(str(cluster_id))].copy()


def render_header(meta: dict) -> None:
    st.title("Reddit Product Trend Radar")
    st.caption(
        "Discover product, brand, keyword, and category signals from organic Reddit discussion."
    )
    cols = st.columns(5)
    cols[0].metric("Analysis Week", meta.get("latest_week", "-"))
    cols[1].metric("Reddit Posts", f"{int(meta.get('post_count', 0)):,}")
    cols[2].metric("Trend Clusters", f"{int(meta.get('cluster_count', 0)):,}")
    cols[3].metric("Brand Signals", f"{int(meta.get('brand_signal_count', 0)):,}")
    cols[4].metric("Avg Trend Score", f"{float(meta.get('avg_trend_score', 0)):.2f}")


def render_home(meta: dict) -> None:
    st.subheader("Home")
    st.write(
        "Use Explore for interactive product discovery, and Analytics Dashboard for score validation, "
        "raw evidence, weekly movement, and keyword sentiment."
    )
    st.info(
        "Daily RSS collection is the provisional signal layer. Weekly Arctic Shift backfill is the finalized weekly signal layer."
    )


def render_explore(clusters: pd.DataFrame, brands: pd.DataFrame, keywords: pd.DataFrame, posts: pd.DataFrame) -> None:
    st.subheader("Explore Signals")
    selected_score = st.radio(
        "Rank categories by",
        list(SCORE_OPTIONS.keys()),
        horizontal=True,
        help="These are the same five dimensions used in the product UI.",
    )
    score_key = SCORE_OPTIONS[selected_score]
    ranked = clusters.sort_values(score_key, ascending=False).reset_index(drop=True)

    left, right = st.columns([0.9, 1.25], gap="large")
    with left:
        st.markdown("#### Trend Categories")
        rows = ranked[["cluster_id", "cluster_name", "current_week_posts", "unique_subreddits", score_key]].head(30)
        display = rows.rename(
            columns={
                "cluster_name": "Category",
                "current_week_posts": "Posts",
                "unique_subreddits": "Subreddits",
                score_key: selected_score,
            }
        )
        st.dataframe(display.drop(columns=["cluster_id"]), use_container_width=True, hide_index=True)

    with right:
        selected_name = st.selectbox("Selected category", ranked["cluster_name"].tolist())
        cluster = ranked[ranked["cluster_name"].eq(selected_name)].iloc[0]
        st.markdown(f"#### {selected_name}")
        score_cols = st.columns(5)
        for col, label in zip(score_cols, SCORE_OPTIONS.keys(), strict=True):
            value = cluster[SCORE_OPTIONS[label]]
            col.markdown(f"**{label}**  \n<span class='stars'>{star_rating(value)}</span>", unsafe_allow_html=True)

        cluster_id = str(cluster["cluster_id"])
        st.markdown("##### Related brands")
        brand_rows = brands[brands["cluster_id"].astype(str).eq(cluster_id)].head(8).copy()
        if brand_rows.empty:
            st.caption("No brand rows for this selected category.")
        else:
            brand_rows["Google"] = brand_rows["brand_display"].map(
                lambda x: f"https://www.google.com/search?q={quote_plus(str(x) + ' brand')}"
            )
            st.dataframe(
                brand_rows[["brand_display", "brand_signal_type", "mentions", "avg_sentiment", "Google"]].rename(
                    columns={
                        "brand_display": "Brand",
                        "brand_signal_type": "Tag",
                        "mentions": "Mentions",
                        "avg_sentiment": "Avg Sentiment",
                    }
                ),
                use_container_width=True,
                hide_index=True,
            )

        st.markdown("##### Keywords")
        term_rows = keywords[keywords["cluster_id"].astype(str).eq(cluster_id)].head(12)
        if not term_rows.empty:
            st.dataframe(
                term_rows[["term", "entity_type", "mentions", "sentiment"]].rename(
                    columns={
                        "term": "Keyword",
                        "entity_type": "Type",
                        "mentions": "Mentions",
                        "sentiment": "Sentiment",
                    }
                ),
                use_container_width=True,
                hide_index=True,
            )

        st.markdown("##### Evidence posts")
        evidence = cluster_posts(posts, cluster_id).head(8)
        st.dataframe(
            evidence[["brand_display", "title", "subreddit", "sentiment_label", "url"]].rename(
                columns={
                    "brand_display": "Brand",
                    "title": "Post",
                    "subreddit": "Subreddit",
                    "sentiment_label": "Sentiment",
                    "url": "URL",
                }
            ),
            use_container_width=True,
            hide_index=True,
        )


def render_dashboard(clusters: pd.DataFrame, keywords: pd.DataFrame, posts: pd.DataFrame) -> None:
    st.subheader("Analytics Dashboard")
    st.caption("Score validation, selected-category raw data, daily movement, and keyword sentiment.")

    ranked = clusters.sort_values("trend_score", ascending=False).head(24)
    fig = px.bar(
        ranked.sort_values("trend_score"),
        x="trend_score",
        y="cluster_name",
        orientation="h",
        labels={"trend_score": "Trend Score", "cluster_name": "Category"},
        title="Category Trend Score Ranking",
        color="trend_score",
        color_continuous_scale=["#14f1ff", "#ff3f8f"],
    )
    fig.update_layout(height=620, margin=dict(l=10, r=10, t=50, b=10), coloraxis_showscale=False)
    st.plotly_chart(fig, use_container_width=True)

    st.markdown("#### Dimension Rankings")
    cols = st.columns(4)
    for col, (label, key) in zip(cols, list(SCORE_OPTIONS.items())[1:], strict=True):
        top = clusters.sort_values(key, ascending=False).head(10).copy()
        fig_small = px.bar(
            top.sort_values(key),
            x=key,
            y="cluster_name",
            orientation="h",
            labels={key: label, "cluster_name": ""},
            title=label,
            color=key,
            color_continuous_scale=["#102b44", "#14f1ff"],
        )
        fig_small.update_layout(height=360, margin=dict(l=0, r=0, t=42, b=0), coloraxis_showscale=False)
        col.plotly_chart(fig_small, use_container_width=True)

    category = st.selectbox(
        "Category Filter",
        clusters.sort_values("cluster_name")["cluster_name"].tolist(),
        index=0,
    )
    cluster = clusters[clusters["cluster_name"].eq(category)].iloc[0]
    cluster_id = str(cluster["cluster_id"])

    st.markdown("#### Raw Data")
    raw = cluster_posts(posts, cluster_id).head(60).copy()
    if raw.empty:
        st.warning("No raw post rows for the selected category in the current dashboard bundle.")
    else:
        raw_display = raw[["brand_display", "title", "subreddit", "published_at", "sentiment_label", "url"]].rename(
            columns={
                "brand_display": "Brand / Signal",
                "title": "Original Reddit Post",
                "subreddit": "Subreddit",
                "published_at": "Published At",
                "sentiment_label": "Sentiment",
                "url": "URL",
            }
        )
        st.dataframe(raw_display, use_container_width=True, hide_index=True)

    st.markdown("#### Selected Category Topic Cloud")
    term_rows = keywords[keywords["cluster_id"].astype(str).eq(cluster_id)].sort_values("mentions", ascending=False)
    if term_rows.empty:
        st.caption("No keyword rows for this selected category.")
    else:
        cols = st.columns(4)
        for idx, row in enumerate(term_rows.head(20).itertuples(index=False)):
            cols[idx % 4].markdown(
                f"<div class='signal-card'><b>{row.term}</b><br><span class='small-muted'>{row.entity_type} · {row.mentions} mentions</span></div>",
                unsafe_allow_html=True,
            )

        fig_terms = px.scatter(
            term_rows.head(30),
            x="mentions",
            y="sentiment",
            size="mentions",
            color="sentiment",
            hover_name="term",
            labels={"mentions": "Mentions", "sentiment": "Avg Sentiment"},
            title="Keyword Sentiment",
            color_continuous_scale=["#ff3f8f", "#14f1ff", "#2de58d"],
        )
        fig_terms.update_layout(height=420, margin=dict(l=10, r=10, t=50, b=10), coloraxis_showscale=False)
        st.plotly_chart(fig_terms, use_container_width=True)

    st.markdown("#### Daily Posts + Avg Sentiment")
    if raw.empty:
        st.caption("No daily rows available.")
        return
    daily = raw.copy()
    daily["published_at"] = pd.to_datetime(daily["published_at"], errors="coerce")
    daily = daily.dropna(subset=["published_at"])
    daily["date"] = daily["published_at"].dt.date.astype(str)
    daily_rows = (
        daily.groupby("date", as_index=False)
        .agg(posts=("title", "count"), avg_sentiment=("sentiment_compound", "mean"))
        .sort_values("date")
    )
    fig_daily = go.Figure()
    fig_daily.add_bar(x=daily_rows["date"], y=daily_rows["posts"], name="Posts", marker_color="#ff3f8f")
    fig_daily.add_scatter(
        x=daily_rows["date"],
        y=daily_rows["avg_sentiment"],
        name="Avg Sentiment",
        mode="lines+markers",
        yaxis="y2",
        line=dict(color="#14f1ff", width=3),
    )
    fig_daily.update_layout(
        height=420,
        yaxis=dict(title="Posts"),
        yaxis2=dict(title="Avg Sentiment", overlaying="y", side="right"),
        margin=dict(l=10, r=10, t=20, b=10),
    )
    st.plotly_chart(fig_daily, use_container_width=True)


def main() -> None:
    with st.sidebar:
        st.header("Data")
        bundle_path = st.text_input("Dashboard bundle", value=str(DEFAULT_BUNDLE))
        page = st.radio("Page", ["Home", "Explore", "Analytics Dashboard"])
        st.caption("Run `python scripts/build_web_dashboard_bundle.py` before launching the app when data changes.")

    try:
        data = load_bundle(bundle_path)
    except FileNotFoundError:
        st.error(f"Dashboard bundle not found: {bundle_path}")
        st.stop()
    except json.JSONDecodeError as exc:
        st.error(f"Dashboard bundle is not valid JSON: {exc}")
        st.stop()

    clusters = frame(data.get("clusters", []))
    keywords = frame(data.get("keywords", []))
    brands = frame(data.get("brands", []))
    posts = frame(data.get("posts", []))

    if clusters.empty:
        st.error("No cluster rows found in the dashboard bundle.")
        st.stop()

    render_header(data.get("meta", {}))

    if page == "Home":
        render_home(data.get("meta", {}))
    elif page == "Explore":
        render_explore(clusters, brands, keywords, posts)
    else:
        render_dashboard(clusters, keywords, posts)


if __name__ == "__main__":
    main()
