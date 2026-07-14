"use client";

import { useEffect, useMemo, useState } from "react";
import { BrandAvatar } from "./components/BrandAvatar";

type ClusterTerm = {
  term: string;
  entity_type?: string;
  mentions?: number;
  sentiment?: number;
};

type ClusterBrand = {
  brand_display: string;
  brand_signal_type?: string;
  mentions?: number;
  sentiment?: number;
  google_search_url?: string;
  logo_url?: string;
};

type Cluster = {
  week_start: string;
  cluster_id: string;
  cluster_name: string;
  trend_score: number;
  trend_score_100: number;
  momentum_score: number;
  sentiment_score: number;
  cross_community_score: number;
  engagement_score: number;
  current_week_posts: number;
  previous_week_posts: number;
  growth_rate: number;
  unique_subreddits: number;
  avg_sentiment?: number;
  avg_log_engagement?: number;
  terms: ClusterTerm[];
  brands: ClusterBrand[];
};

type Keyword = {
  term: string;
  term_norm?: string;
  entity_type?: string;
  cluster_id: string;
  cluster_name: string;
  mentions: number;
  sentiment?: number;
};

type Brand = {
  brand_display: string;
  brand_norm?: string;
  brand_signal_type?: string;
  cluster_id: string;
  cluster_name: string;
  mentions: number;
  unique_posts?: number;
  avg_sentiment?: number;
  google_search_url?: string;
  logo_url?: string;
};

type Post = {
  brand_display?: string;
  brand_norm?: string;
  cluster_id: string;
  cluster_name: string;
  title: string;
  text_snippet?: string;
  subreddit?: string;
  published_at?: string;
  url?: string;
  sentiment_label?: string;
  sentiment_compound?: number;
  context_window?: string;
};

type DashboardBundle = {
  meta: {
    latest_week: string;
    cluster_count: number;
    post_count: number;
    brand_signal_count: number;
    term_signal_count?: number;
    avg_trend_score: number;
    max_trend_score?: number;
  };
  clusters: Cluster[];
  keywords: Keyword[];
  brands: Brand[];
  posts: Post[];
  weeks: string[];
};

type View = "home" | "explore" | "dashboard";
type ExploreTab = "trend" | "opportunity" | "mapping" | "sparkle" | "evidence";

const scoreOptions = [
  { key: "trend_score", label: "Overall", helper: "Combined priority for opportunity ranking." },
  { key: "momentum_score", label: "Momentum", helper: "How quickly discussion is rising." },
  { key: "sentiment_score", label: "Sentiment", helper: "Consumer language positivity or negativity." },
  { key: "cross_community_score", label: "Reach", helper: "How broadly the signal spreads across communities." },
  { key: "engagement_score", label: "Engagement", helper: "Attention from comments and reactions." }
] as const;

type ScoreKey = (typeof scoreOptions)[number]["key"];

const scoreLabel = Object.fromEntries(scoreOptions.map((item) => [item.key, item.label])) as Record<ScoreKey, string>;

function fmt(value: number | undefined, digits = 1) {
  return Number(value || 0).toFixed(digits);
}

// meta.latest_week is just the week's Monday (week_start); show the full Mon-Sun range
// instead of a single date so "Analysis Week" actually reads as a week, not a day.
function formatWeekRange(weekStart: string): string {
  if (!weekStart) return "—";
  const start = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return weekStart;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const dayOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const startLabel = start.toLocaleDateString("en-US", dayOpts);
  const endLabel = end.toLocaleDateString("en-US", { ...dayOpts, year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

function starRating(value: number | undefined, className = "") {
  const score = Math.max(0, Math.min(5, Number(value || 0)));
  const full = Math.round(score);
  return (
    <span className={`stars ${className}`} title={`${fmt(score, 1)} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index < full ? "on" : ""}>
          {index < full ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}

function brandTag(type?: string) {
  return type ? type.replaceAll("_", " ") : "other";
}

function sentimentClass(value?: number | string) {
  if (typeof value === "string") return value || "neutral";
  if (Number(value || 0) >= 0.15) return "positive";
  if (Number(value || 0) <= -0.08) return "negative";
  return "neutral";
}

function sentimentValue(value?: number) {
  const score = Number(value || 0);
  const tag = sentimentClass(score);
  return (
    <span className={`sentimentTag ${tag}`}>
      {score >= 0 ? "+" : ""}
      {fmt(score, 2)} · {tag}
    </span>
  );
}

// Real week-over-week multiple (current / previous), not the percentage-style
// growth_rate field -- growth_rate = (current - previous) / previous under-reports
// the actual multiple by 1x (doubling shows as "1.0x" instead of "2.0x").
function spikeRatio(cluster: Cluster): number | null {
  const previous = Number(cluster.previous_week_posts || 0);
  const current = Number(cluster.current_week_posts || 0);
  if (previous <= 0) return null;
  return current / previous;
}

function spikeValue(cluster: Cluster): string {
  const ratio = spikeRatio(cluster);
  return ratio === null ? "new" : `${fmt(ratio, 1)}x`;
}

function spikeLabel(cluster: Cluster): string {
  return `spike: ${spikeValue(cluster)}`;
}

function dimensionRawValue(cluster: Cluster, key: ScoreKey) {
  if (key === "momentum_score") return <span className="rawValue">{cluster.current_week_posts} posts · {spikeLabel(cluster)}</span>;
  if (key === "engagement_score") return <span className="rawValue">{fmt(cluster.avg_log_engagement, 2)} engagement</span>;
  if (key === "cross_community_score") return <span className="rawValue">{cluster.unique_subreddits} subreddits</span>;
  if (key === "sentiment_score") return sentimentValue(cluster.avg_sentiment);
  return <span className="rawValue">{fmt(cluster.trend_score, 1)}</span>;
}

function clusterInitials(name: string) {
  return name
    .split(/\s|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function googleBrandUrl(name: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} brand`)}`;
}

type MomentumTag = { label: string; tone: "opportunity" | "engagement" | "broad" | "risk" | "steady" };

// Numeric scores stay available in every detail view (Dashboard, category stat grid); this
// is an additional at-a-glance read for list rows, not a replacement for the underlying data.
function momentumTag(cluster: Cluster): MomentumTag {
  if (Number(cluster.previous_week_posts || 0) === 0) return { label: "Emerging", tone: "opportunity" };
  if (Number(cluster.growth_rate || 0) >= 2) return { label: "Exploding", tone: "opportunity" };
  if (Number(cluster.momentum_score || 0) >= 4) return { label: "High Engagement", tone: "engagement" };
  if (Number(cluster.cross_community_score || 0) >= 4) return { label: "Broad Adoption", tone: "broad" };
  if (Number(cluster.sentiment_score || 0) <= 2) return { label: "Risk", tone: "risk" };
  return { label: "Steady", tone: "steady" };
}

function TagPill({ tag }: { tag: MomentumTag }) {
  return <span className={`tag tag-${tag.tone}`}>{tag.label}</span>;
}

function clusterPosts(posts: Post[], clusterId: string) {
  return posts.filter((post) => String(post.cluster_id) === String(clusterId));
}

function aggregateTerms(keywords: Keyword[]): ClusterTerm[] {
  const grouped = new Map<string, { term: string; mentions: number; weightedSentiment: number }>();
  keywords.forEach((term) => {
    const key = String(term.term || "").toLowerCase();
    if (!key) return;
    const current = grouped.get(key) || { term: term.term, mentions: 0, weightedSentiment: 0 };
    const mentions = Number(term.mentions || 0);
    current.mentions += mentions;
    current.weightedSentiment += Number(term.sentiment || 0) * Math.max(mentions, 1);
    grouped.set(key, current);
  });
  return [...grouped.values()]
    .map((term) => ({ term: term.term, mentions: term.mentions, sentiment: term.weightedSentiment / Math.max(term.mentions, 1) }))
    .sort((a, b) => Number(b.mentions || 0) - Number(a.mentions || 0))
    .slice(0, 24);
}

export default function RadarApp() {
  const [data, setData] = useState<DashboardBundle | null>(null);
  const [view, setView] = useState<View>("home");
  const [tab, setTab] = useState<ExploreTab>("trend");
  const [sortBy, setSortBy] = useState<ScoreKey>("trend_score");
  const [selectedClusterId, setSelectedClusterId] = useState<string>("");
  const [onlyBrand, setOnlyBrand] = useState(false);
  const [brandQuery, setBrandQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedSignalKey, setSelectedSignalKey] = useState("");
  const [opportunityZoom, setOpportunityZoom] = useState(1);
  const [opportunityDrag, setOpportunityDrag] = useState(0);
  const [dashboardCategoryId, setDashboardCategoryId] = useState("all");
  const [sparkleCategoryId, setSparkleCategoryId] = useState("all");

  useEffect(() => {
    fetch("/data/dashboard.json", { cache: "no-store" })
      .then((response) => response.json())
      .then((bundle: DashboardBundle) => {
        setData(bundle);
        setSelectedClusterId(bundle.clusters[0]?.cluster_id || "");
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  }, []);

  const clusters = useMemo(() => {
    if (!data) return [];
    return [...data.clusters].sort((a, b) => Number(b[sortBy] || 0) - Number(a[sortBy] || 0));
  }, [data, sortBy]);

  const selectedCluster = useMemo(() => {
    if (!data) return undefined;
    return data.clusters.find((cluster) => cluster.cluster_id === selectedClusterId) || data.clusters[0];
  }, [data, selectedClusterId]);

  const signalCards = useMemo(() => {
    if (!data) return [];
    const selectedCategory = categoryFilter.trim().toLowerCase();
    const query = brandQuery.trim().toLowerCase();
    const items = [
      ...data.keywords.map((item) => ({
        key: `keyword:${item.term.toLowerCase()}`,
        kind: "keyword" as const,
        display: item.term,
        cluster_id: item.cluster_id,
        cluster_name: item.cluster_name,
        mentions: item.mentions,
        sentiment: item.sentiment || 0,
        tag: item.entity_type || "keyword",
        url: ""
      })),
      ...data.brands.map((item) => ({
        key: `brand:${item.brand_display.toLowerCase()}`,
        kind: "brand" as const,
        display: item.brand_display,
        cluster_id: item.cluster_id,
        cluster_name: item.cluster_name,
        mentions: item.mentions,
        sentiment: item.avg_sentiment || 0,
        tag: brandTag(item.brand_signal_type),
        url: item.google_search_url || googleBrandUrl(item.brand_display),
        logoUrl: item.logo_url || ""
      }))
    ];
    const grouped = new Map<
      string,
      {
        key: string;
        kind: "keyword" | "brand";
        display: string;
        mentions: number;
        sentimentTotal: number;
        clusters: Set<string>;
        clusterIds: Set<string>;
        tags: Set<string>;
        url: string;
        logoUrl: string;
      }
    >();
    items
      .filter((item) => !selectedCategory || item.cluster_name.toLowerCase() === selectedCategory)
      .filter((item) => !onlyBrand || item.kind === "brand")
      .filter((item) => !query || (item.kind === "brand" && item.display.toLowerCase().includes(query)))
      .forEach((item) => {
        const current =
          grouped.get(item.key) ||
          {
            key: item.key,
            kind: item.kind,
            display: item.display,
            mentions: 0,
            sentimentTotal: 0,
            clusters: new Set<string>(),
            clusterIds: new Set<string>(),
            tags: new Set<string>(),
            url: item.url,
            logoUrl: "logoUrl" in item ? item.logoUrl : ""
          };
        current.mentions += Number(item.mentions || 0);
        current.sentimentTotal += Number(item.sentiment || 0) * Math.max(Number(item.mentions || 0), 1);
        current.clusters.add(item.cluster_name);
        current.clusterIds.add(item.cluster_id);
        current.tags.add(item.tag);
        if (!current.url) current.url = item.url;
        if (!current.logoUrl && "logoUrl" in item) current.logoUrl = item.logoUrl;
        grouped.set(item.key, current);
      });
    return [...grouped.values()]
      .map((item) => ({
        ...item,
        sentiment: item.sentimentTotal / Math.max(item.mentions, 1),
        clusterList: [...item.clusters],
        clusterIdList: [...item.clusterIds],
        tagList: [...item.tags]
      }))
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 80);
  }, [brandQuery, categoryFilter, data, onlyBrand]);

  useEffect(() => {
    if (signalCards.length && !signalCards.some((item) => item.key === selectedSignalKey)) {
      setSelectedSignalKey(signalCards[0].key);
    }
  }, [selectedSignalKey, signalCards]);

  if (!data || !selectedCluster) {
    return <main className="shell loading">Loading Reddit Product Trend Radar...</main>;
  }

  const activePosts = clusterPosts(data.posts, selectedCluster.cluster_id);
  const applySortBy = (key: ScoreKey) => {
    setSortBy(key);
    const topCluster = [...data.clusters].sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))[0];
    if (topCluster) setSelectedClusterId(topCluster.cluster_id);
  };
  const openClusterDetail = (clusterId: string) => {
    setSelectedClusterId(clusterId);
    setTab("trend");
  };

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("home")}>
          <span>r/</span>
          Reddit Product Trend Radar
        </button>
        <nav>
          {(["home", "explore", "dashboard"] as View[]).map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
              {item === "home" ? "Home" : item === "explore" ? "Explore" : "Analytics"}
            </button>
          ))}
        </nav>
        <button className="ghost" onClick={() => window.print()}>
          Export
        </button>
      </header>

      {view === "home" && <Home data={data} setView={setView} />}

      {view === "explore" && (
        <section>
          <SectionHeader
            kicker="Interactive Product"
            title="Explore Signals"
            body="Interactive exploration layer for categories, opportunities, keywords, brands, and evidence."
          />
          <div className="tabs">
            {[
              ["trend", "Trend Categories"],
              ["opportunity", "Opportunity Discovery"],
              ["mapping", "Keyword / Brand Detail"],
              ["sparkle", "New & Emerging"]
            ].map(([key, label], index) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key as ExploreTab)}
              >
                <small>Tab {index + 1}</small>
                <strong>{label}</strong>
              </button>
            ))}
          </div>

          {tab === "trend" && (
            <TrendTab
              clusters={clusters}
              selectedCluster={selectedCluster}
              posts={activePosts}
              sortBy={sortBy}
              setSortBy={applySortBy}
              setSelectedClusterId={setSelectedClusterId}
              setTab={setTab}
            />
          )}

          {tab === "opportunity" && (
            <OpportunityTab
              clusters={data.clusters}
              selectedClusterId={selectedCluster.cluster_id}
              zoom={opportunityZoom}
              drag={opportunityDrag}
              setZoom={setOpportunityZoom}
              setDrag={setOpportunityDrag}
              openClusterDetail={openClusterDetail}
            />
          )}

          {tab === "mapping" && (
            <MappingTab
              clusters={data.clusters}
              signalCards={signalCards}
              selectedSignalKey={selectedSignalKey}
              onlyBrand={onlyBrand}
              brandQuery={brandQuery}
              categoryFilter={categoryFilter}
              setOnlyBrand={setOnlyBrand}
              setBrandQuery={setBrandQuery}
              setCategoryFilter={setCategoryFilter}
              setSelectedSignalKey={setSelectedSignalKey}
              setSelectedClusterId={setSelectedClusterId}
              setTab={setTab}
            />
          )}

          {tab === "sparkle" && (
            <SparkleTab
              clusters={data.clusters}
              brands={data.brands}
              selectedCluster={selectedCluster}
              sparkleCategoryId={sparkleCategoryId}
              setSparkleCategoryId={setSparkleCategoryId}
              setSelectedClusterId={setSelectedClusterId}
              setSelectedSignalKey={setSelectedSignalKey}
              setOnlyBrand={setOnlyBrand}
              setTab={setTab}
            />
          )}

          {tab === "evidence" && (
            <EvidenceTab
              cluster={selectedCluster}
              posts={activePosts.length ? activePosts : data.posts.slice(0, 12)}
              setTab={setTab}
            />
          )}
        </section>
      )}

      {view === "dashboard" && (
        <Dashboard
          data={data}
          selectedCluster={selectedCluster}
          dashboardCategoryId={dashboardCategoryId}
          setDashboardCategoryId={setDashboardCategoryId}
          setSelectedClusterId={setSelectedClusterId}
        />
      )}
    </main>
  );
}

function Home({ data, setView }: { data: DashboardBundle; setView: (view: View) => void }) {
  return (
    <section className="hero">
      <div className="eyebrow">AI powered real consumer signals</div>
      <h1>Reddit - North America Product Trend Radar</h1>
      <p>Identify emerging product opportunities from real consumer discussions before they appear in marketplace metrics.</p>
      <div className="stats">
        <Stat label="Analysis Week" value={formatWeekRange(data.meta.latest_week)} />
        <Stat label="Reddit Posts" value={data.meta.post_count.toLocaleString()} />
        <Stat label="Trend Clusters" value={String(data.meta.cluster_count)} />
        <Stat label="Brand Signals" value={data.meta.brand_signal_count.toLocaleString()} />
        <Stat label="Avg Trend Score" value={fmt(data.meta.avg_trend_score, 2)} />
      </div>
      <div className="routeCards">
        <button onClick={() => setView("explore")}>
          <span>Interactive Product</span>
          <strong>Explore Trends</strong>
          <small>Find categories, keywords, brands, and evidence worth reviewing this week.</small>
        </button>
        <button onClick={() => setView("dashboard")}>
          <span>Analytics</span>
          <strong>Analytics Dashboard</strong>
          <small>Validate scores, rankings, raw data, weekly movement, and keyword sentiment.</small>
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SectionHeader({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <header className="sectionHeader">
      <span>{kicker}</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </header>
  );
}

function TrendTab({
  clusters,
  selectedCluster,
  posts,
  sortBy,
  setSortBy,
  setSelectedClusterId,
  setTab
}: {
  clusters: Cluster[];
  selectedCluster: Cluster;
  posts: Post[];
  sortBy: ScoreKey;
  setSortBy: (key: ScoreKey) => void;
  setSelectedClusterId: (id: string) => void;
  setTab: (tab: ExploreTab) => void;
}) {
  return (
    <div className="trendGrid">
      <article className="panel wide">
        <div className="panelHeader">
          <span>Signal Dimensions</span>
          <h3>Rank by score dimension</h3>
        </div>
        <div className="dimensionFilters">
          {scoreOptions.map((option) => (
            <button key={option.key} className={sortBy === option.key ? "active" : ""} onClick={() => setSortBy(option.key)}>
              <strong>{option.label}</strong>
              <small>{option.helper}</small>
            </button>
          ))}
        </div>
      </article>
      <article className="panel">
        <div className="panelHeader">
          <span>Ranking</span>
          <h3>Trend Categories</h3>
        </div>
        <div className="clusterList">
          {clusters.slice(0, 28).map((cluster, index) => (
            <button
              key={cluster.cluster_id}
              className={selectedCluster.cluster_id === cluster.cluster_id ? "active" : ""}
              onClick={() => setSelectedClusterId(cluster.cluster_id)}
            >
              <b>#{index + 1}</b>
              <i>{clusterInitials(cluster.cluster_name)}</i>
              <span>
                <strong>{cluster.cluster_name}</strong>
                <small>
                  {cluster.current_week_posts} posts · {cluster.unique_subreddits} subs · sorted by {scoreLabel[sortBy]}
                </small>
                <TagPill tag={momentumTag(cluster)} />
              </span>
            </button>
          ))}
        </div>
      </article>
      <article className="panel">
        <div className="panelHeader">
          <span>Category Detail</span>
          <h3>{selectedCluster.cluster_name}</h3>
        </div>
        <div className="starStack">
          {scoreOptions.map((option) => (
            <div key={option.key}>
              <span>{option.label}</span>
              {option.key === "sentiment_score" ? sentimentValue(selectedCluster.avg_sentiment) : starRating(Number(selectedCluster[option.key]))}
            </div>
          ))}
        </div>
        <h4>Active sources</h4>
        <div className="sourceGrid">
          {subredditSources(posts).map((source) => (
            <a key={source.subreddit} href={`https://www.reddit.com/r/${source.subreddit}`} target="_blank" rel="noreferrer">
              <b>r/{source.subreddit}</b>
              <small>{source.posts} posts</small>
            </a>
          ))}
        </div>
        <h4>Topic landscape</h4>
        <div className="wordCloud">
          {selectedCluster.terms.map((term) => (
            <button key={term.term} className={sentimentClass(term.sentiment)}>
              {term.term}
            </button>
          ))}
        </div>
        <h4>Related brands & keywords</h4>
        <div className="productCards">
          {[...selectedCluster.brands.map((item) => ({ type: "brand", name: item.brand_display, tag: brandTag(item.brand_signal_type), mentions: item.mentions || 0, url: item.google_search_url || googleBrandUrl(item.brand_display), logoUrl: item.logo_url || "" })), ...selectedCluster.terms.map((item) => ({ type: "keyword", name: item.term, tag: item.entity_type || "keyword", mentions: item.mentions || 0, url: "", logoUrl: "" }))].slice(0, 18).map((item) => (
            <div key={`${item.type}-${item.name}`}>
              {item.type === "brand" ? <BrandAvatar name={item.name} logoUrl={item.logoUrl} size="md" /> : <i className="keywordAvatar">#</i>}
              <span className="productCardText">
                <b>{item.name}</b>
                <small>
                  {item.tag} · {item.mentions} mentions
                </small>
              </span>
              <span className="productCardActions">
                {item.type === "brand" && (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    Learn more about the brand
                  </a>
                )}
                <button onClick={() => setTab("evidence")}>Evidence</button>
              </span>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function subredditSources(posts: Post[]) {
  const sources = new Map<string, { subreddit: string; posts: number }>();
  posts.forEach((post) => {
    const subreddit = post.subreddit || "unknown";
    const current = sources.get(subreddit) || { subreddit, posts: 0 };
    current.posts += 1;
    sources.set(subreddit, current);
  });
  return [...sources.values()].sort((a, b) => b.posts - a.posts).slice(0, 5);
}

function OpportunityTab({
  clusters,
  selectedClusterId,
  zoom,
  drag,
  setZoom,
  setDrag,
  openClusterDetail
}: {
  clusters: Cluster[];
  selectedClusterId: string;
  zoom: number;
  drag: number;
  setZoom: (value: number) => void;
  setDrag: (value: number) => void;
  openClusterDetail: (id: string) => void;
}) {
  const maxPosts = Math.max(...clusters.map((cluster) => cluster.current_week_posts), 1);
  const dragOffset = (drag / 100) * (zoom - 1) * 100;
  const broad = [...clusters]
    .sort((a, b) => b.momentum_score + b.cross_community_score - (a.momentum_score + a.cross_community_score))
    .slice(0, 5);
  const niche = [...clusters]
    .sort((a, b) => b.momentum_score - b.cross_community_score - (a.momentum_score - a.cross_community_score))
    .slice(0, 5);
  return (
    <div className="singleColumn">
      <article className="panel">
        <div className="panelHeader">
          <span>Opportunity Quadrant</span>
          <h3>Growth x Reach Map</h3>
        </div>
        <div className="axisControls">
          <label>
            X Zoom
            <input type="range" min="1" max="3" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            <em>{fmt(zoom, 1)}x</em>
          </label>
          <label>
            Drag Right
            <input type="range" min="0" max="100" step="1" value={drag} onChange={(event) => setDrag(Number(event.target.value))} />
            <em>{Math.round(drag)}%</em>
          </label>
        </div>
        <div className="scatter">
          <div className="scatterCanvas" style={{ width: `${zoom * 100}%`, transform: `translateX(-${dragOffset}%)` }}>
            <span className="axis top">High momentum</span>
            <span className="axis right">Reach</span>
            {clusters.slice(0, 60).map((cluster) => {
              const x = Math.min(96, Math.max(4, Number(cluster.cross_community_score || 0) * 18));
              const y = Math.min(92, Math.max(8, Number(cluster.momentum_score || 0) * 18));
              const size = 8 + 22 * (cluster.current_week_posts / maxPosts);
              return (
                <button
                  key={cluster.cluster_id}
                  className={selectedClusterId === cluster.cluster_id ? "active" : ""}
                  title={cluster.cluster_name}
                  style={{ left: `${x}%`, bottom: `${y}%`, width: size, height: size }}
                  onClick={() => openClusterDetail(cluster.cluster_id)}
                />
              );
            })}
          </div>
        </div>
      </article>
      <article className="panel">
        <div className="opportunityLists">
          <OpportunityList title="High Momentum + High Range" rows={broad} openClusterDetail={openClusterDetail} />
          <OpportunityList title="High Momentum + Low Range" rows={niche} openClusterDetail={openClusterDetail} />
        </div>
      </article>
    </div>
  );
}

function OpportunityList({ title, rows, openClusterDetail }: { title: string; rows: Cluster[]; openClusterDetail: (id: string) => void }) {
  return (
    <div>
      <h4>{title}</h4>
      {rows.map((cluster, index) => (
        <button key={cluster.cluster_id} className="opportunityRow" onClick={() => openClusterDetail(cluster.cluster_id)}>
          <b>#{index + 1}</b>
          <span>
            <strong>{cluster.cluster_name}</strong>
            <small>
              {cluster.current_week_posts} posts · {cluster.unique_subreddits} subreddits
            </small>
            <TagPill tag={momentumTag(cluster)} />
          </span>
          <em>›</em>
        </button>
      ))}
    </div>
  );
}

type SignalCard = {
  key: string;
  kind: "keyword" | "brand";
  display: string;
  mentions: number;
  sentiment: number;
  clusterList: string[];
  clusterIdList: string[];
  tagList: string[];
  url: string;
  logoUrl?: string;
};

function MappingTab({
  clusters,
  signalCards,
  selectedSignalKey,
  onlyBrand,
  brandQuery,
  categoryFilter,
  setOnlyBrand,
  setBrandQuery,
  setCategoryFilter,
  setSelectedSignalKey,
  setSelectedClusterId,
  setTab
}: {
  clusters: Cluster[];
  signalCards: SignalCard[];
  selectedSignalKey: string;
  onlyBrand: boolean;
  brandQuery: string;
  categoryFilter: string;
  setOnlyBrand: (value: boolean) => void;
  setBrandQuery: (value: string) => void;
  setCategoryFilter: (value: string) => void;
  setSelectedSignalKey: (value: string) => void;
  setSelectedClusterId: (value: string) => void;
  setTab: (tab: ExploreTab) => void;
}) {
  const selected = signalCards.find((item) => item.key === selectedSignalKey) || signalCards[0];
  return (
    <div className="mappingGrid">
      <article className="panel">
        <div className="panelHeader">
          <span>Signal Detail</span>
          <h3>Keyword / Brand Detail</h3>
        </div>
        <div className="filters">
          <button className={onlyBrand ? "active" : ""} onClick={() => setOnlyBrand(!onlyBrand)}>
            Only Brand
          </button>
          <input value={brandQuery} onChange={(event) => setBrandQuery(event.target.value)} placeholder="Search brand" />
          <input list="category-list" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} placeholder="All categories" />
          <datalist id="category-list">
            {clusters
              .map((cluster) => cluster.cluster_name)
              .sort()
              .map((name) => (
                <option key={name} value={name} />
              ))}
          </datalist>
        </div>
        <div className="termList">
          {signalCards.map((item, index) => (
            <button key={item.key} className={selected?.key === item.key ? "active" : ""} onClick={() => setSelectedSignalKey(item.key)}>
              <b>#{index + 1}</b>
              <strong>{item.display}</strong>
              <span>{item.tagList[0] || item.kind}</span>
            </button>
          ))}
        </div>
      </article>
      <article className="panel stickyPanel">
        <div className="panelHeader">
          <span>Selected Signal</span>
          <h3>{selected?.display || "Choose a signal"}</h3>
        </div>
        {selected && (
          <div className="signalDetail">
            <div className={`signalHero ${selected.kind}`}>
              {selected.kind === "brand" ? <BrandAvatar name={selected.display} logoUrl={selected.logoUrl} size="lg" /> : <i>#</i>}
              <span>
                <strong>{selected.display}</strong>
                <small>{selected.kind === "brand" ? "Brand signal" : "Keyword / product phrase"}</small>
              </span>
            </div>
            <div className="metricGrid">
              <Stat label="Frequency" value={`${selected.mentions} mentions`} />
              <Stat label="Sentiment" value={sentimentClass(selected.sentiment)} />
              <Stat label="Tag" value={selected.tagList.join(", ")} />
              <Stat label="Appears in" value={`${selected.clusterList.length} categories`} />
            </div>
            <h4>Categories</h4>
            <div className="chips">
              {selected.clusterList.map((name, index) => (
                <button
                  key={name}
                  onClick={() => {
                    const clusterId = selected.clusterIdList[index];
                    if (clusterId) setSelectedClusterId(clusterId);
                    setTab("trend");
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            {selected.kind === "brand" && (
              <a className="primaryLink" href={selected.url} target="_blank" rel="noreferrer">
                Learn more about the brand
              </a>
            )}
          </div>
        )}
      </article>
    </div>
  );
}

function SparkleTab({
  clusters,
  brands,
  selectedCluster,
  sparkleCategoryId,
  setSparkleCategoryId,
  setSelectedClusterId,
  setSelectedSignalKey,
  setOnlyBrand,
  setTab
}: {
  clusters: Cluster[];
  brands: Brand[];
  selectedCluster: Cluster;
  sparkleCategoryId: string;
  setSparkleCategoryId: (id: string) => void;
  setSelectedClusterId: (id: string) => void;
  setSelectedSignalKey: (key: string) => void;
  setOnlyBrand: (value: boolean) => void;
  setTab: (tab: ExploreTab) => void;
}) {
  const fresh = clusters
    .filter((cluster) => cluster.previous_week_posts === 0)
    .filter((cluster) => sparkleCategoryId === "all" || cluster.cluster_id === sparkleCategoryId)
    .sort((a, b) => b.current_week_posts - a.current_week_posts)
    .slice(0, 12);
  const newBrands = [...brands]
    .filter((brand) => sparkleCategoryId === "all" || brand.cluster_id === sparkleCategoryId)
    .sort((a, b) => Number(b.mentions || 0) - Number(a.mentions || 0))
    .slice(0, 12);
  return (
    <div className="mappingGrid">
      <article className="panel wide filterPanel">
        <label>
          Category Filter
          <select
            value={sparkleCategoryId}
            onChange={(event) => {
              setSparkleCategoryId(event.target.value);
              if (event.target.value !== "all") setSelectedClusterId(event.target.value);
            }}
          >
            <option value="all">Overall / All categories</option>
            {[...clusters]
              .sort((a, b) => a.cluster_name.localeCompare(b.cluster_name))
              .map((cluster) => (
                <option key={cluster.cluster_id} value={cluster.cluster_id}>
                  {cluster.cluster_name}
                </option>
              ))}
          </select>
        </label>
      </article>
      <article className="panel">
        <div className="panelHeader">
          <span>Fresh Signals</span>
          <h3>New & Emerging</h3>
        </div>
        <div className="sparkleList">
          <div className="sparkleGroup">
            <h4>New Categories</h4>
            {fresh.map((cluster) => (
              <button
                key={cluster.cluster_id}
                onClick={() => {
                  setSelectedClusterId(cluster.cluster_id);
                  setTab("trend");
                }}
              >
                <b>NEW</b>
                <span>
                  <strong>{cluster.cluster_name}</strong>
                  <small>
                    {cluster.current_week_posts} posts · {cluster.unique_subreddits} subreddits
                  </small>
                </span>
                <em>›</em>
              </button>
            ))}
          </div>
          <div className="sparkleGroup">
            <h4>New Brand Signals</h4>
            {newBrands.map((brand) => (
              <button
                key={`${brand.cluster_id}-${brand.brand_display}`}
                onClick={() => {
                  setSelectedClusterId(brand.cluster_id);
                  setSelectedSignalKey(`brand:${brand.brand_display.toLowerCase()}`);
                  setOnlyBrand(true);
                  setTab("mapping");
                }}
              >
                <BrandAvatar name={brand.brand_display} logoUrl={brand.logo_url} size="md" />
                <span>
                  <strong>{brand.brand_display}</strong>
                  <small>{brand.mentions} mentions · {brandTag(brand.brand_signal_type)}</small>
                </span>
                <em>›</em>
              </button>
            ))}
          </div>
        </div>
      </article>
      <article className="panel">
        <div className="panelHeader">
          <span>Selected Signal</span>
          <h3>{selectedCluster.cluster_name}</h3>
        </div>
        <div className="starStack">
          <div>
            <span>First-week posts</span>
            <strong>{selectedCluster.current_week_posts}</strong>
          </div>
          <div>
            <span>Sentiment</span>
            {sentimentValue(selectedCluster.avg_sentiment)}
          </div>
          <div>
            <span>Spike</span>
            <strong>{spikeValue(selectedCluster)}</strong>
          </div>
          <div>
            <span>Subreddits</span>
            <strong>{selectedCluster.unique_subreddits}</strong>
          </div>
        </div>
        <h4>Fresh keywords</h4>
        <div className="chips">
          {selectedCluster.terms.map((term) => (
            <span key={term.term}>{term.term}</span>
          ))}
        </div>
      </article>
    </div>
  );
}

function EvidenceTab({ cluster, posts, setTab }: { cluster: Cluster; posts: Post[]; setTab: (tab: ExploreTab) => void }) {
  return (
    <article className="panel">
      <div className="panelHeader splitHeader">
        <span>Evidence</span>
        <h3>{cluster.cluster_name} · Reddit Evidence</h3>
        <button className="ghost" onClick={() => setTab("trend")}>
          Back to Category
        </button>
      </div>
      <div className="evidenceGrid">
        {posts.map((post, index) => (
          <article key={`${post.url || post.title}-${index}`}>
            <div>
              <strong>{post.title}</strong>
              <span>r/{post.subreddit || "unknown"}</span>
            </div>
            <p>{post.context_window || post.text_snippet}</p>
            <div>
              <span>
                {post.brand_display || "Reddit"} · {post.sentiment_label || "neutral"}
              </span>
              <a href={post.url || "#"} target="_blank" rel="noreferrer">
                Open Reddit
              </a>
            </div>
          </article>
        ))}
      </div>
    </article>
  );
}

function Dashboard({
  data,
  selectedCluster,
  dashboardCategoryId,
  setDashboardCategoryId,
  setSelectedClusterId,
}: {
  data: DashboardBundle;
  selectedCluster: Cluster;
  dashboardCategoryId: string;
  setDashboardCategoryId: (id: string) => void;
  setSelectedClusterId: (id: string) => void;
}) {
  const dashboardCluster = dashboardCategoryId === "all"
    ? undefined
    : data.clusters.find((cluster) => cluster.cluster_id === dashboardCategoryId) || selectedCluster;
  const rawRows = dashboardCluster ? clusterPosts(data.posts, dashboardCluster.cluster_id) : data.posts;
  const dashboardTerms = dashboardCluster ? dashboardCluster.terms : aggregateTerms(data.keywords);
  const maxTrend = Math.max(...data.clusters.map((cluster) => cluster.trend_score), 1);
  return (
    <section>
      <SectionHeader
        kicker="Visualization Board"
        title="Analytics Dashboard"
        body="Score validation, raw evidence, selected-category word cloud, daily movement, and keyword sentiment."
      />
      <div className="dashboardGrid">
        <article className="panel wide">
          <div className="panelHeader">
            <span>Overall</span>
            <h3>Category Trend Score Ranking</h3>
          </div>
          <div className="barChart">
            {data.clusters.slice(0, 24).map((cluster) => (
              <button key={cluster.cluster_id} onClick={() => setSelectedClusterId(cluster.cluster_id)}>
                <span>{cluster.cluster_name}</span>
                <i>
                  <b style={{ width: `${(cluster.trend_score / maxTrend) * 100}%` }} />
                </i>
                <strong>{fmt(cluster.trend_score, 1)}</strong>
              </button>
            ))}
          </div>
        </article>
        {scoreOptions.slice(1).map((option) => (
          <article key={option.key} className="panel">
            <div className="panelHeader">
              <span>{option.label}</span>
              <h3>{option.label} Ranking</h3>
            </div>
            <div className="dimensionChart">
              {[...data.clusters]
                .sort((a, b) => Number(b[option.key]) - Number(a[option.key]))
                .slice(0, 10)
                .map((cluster, index) => (
                  <button key={cluster.cluster_id} onClick={() => setSelectedClusterId(cluster.cluster_id)}>
                    <b>#{index + 1}</b>
                    <span>{cluster.cluster_name}</span>
                    <i>
                      <b style={{ width: `${Math.max(4, Number(cluster[option.key]) * 20)}%` }} />
                    </i>
                    <em>{dimensionRawValue(cluster, option.key)}</em>
                  </button>
                ))}
            </div>
          </article>
        ))}
        <article className="panel wide rawPanel">
          <div className="panelHeader">
            <span>Raw Data</span>
            <h3>Selected Category Reddit Rows</h3>
          </div>
          <RawTable rows={rawRows.length ? rawRows : data.posts.slice(0, 12)} />
        </article>
        <article className="panel wide filterPanel">
          <label>
            Category Filter
            <select
              value={dashboardCategoryId}
              onChange={(event) => {
                setDashboardCategoryId(event.target.value);
                if (event.target.value !== "all") setSelectedClusterId(event.target.value);
              }}
            >
              <option value="all">Overall / All categories</option>
              {[...data.clusters]
                .sort((a, b) => a.cluster_name.localeCompare(b.cluster_name))
                .map((cluster) => (
                  <option key={cluster.cluster_id} value={cluster.cluster_id}>
                    {cluster.cluster_name}
                  </option>
                ))}
            </select>
          </label>
        </article>
        <article className="panel wide">
          <div className="panelHeader">
            <span>Topic</span>
            <h3>Word Cloud</h3>
          </div>
          <div className="wordCloud dashboard">
            {dashboardTerms.map((term) => (
              <button key={term.term} className={sentimentClass(term.sentiment)}>
                {term.term}
              </button>
            ))}
          </div>
        </article>
        <article className="panel half">
          <div className="panelHeader">
            <span>Weekly Trend</span>
            <h3>Daily Posts + Avg Sentiment</h3>
          </div>
          <DailyChart posts={rawRows} />
        </article>
        <article className="panel half">
          <div className="panelHeader">
            <span>Keyword Sentiment</span>
            <h3>Keyword Sentiment</h3>
          </div>
          <KeywordSentiment terms={dashboardTerms} zoom={1} />
        </article>
      </div>
    </section>
  );
}

function RawTable({ rows }: { rows: Post[] }) {
  return (
    <div className="rawTable">
      <div className="rawHead">
        <span>Brand / Signal</span>
        <span>Post</span>
        <span>Subreddit</span>
        <span>Sentiment</span>
        <span>URL</span>
      </div>
      <div className="rawBody">
        {rows.map((post, index) => (
          <div key={`${post.url || post.title}-${index}`} className="rawRow">
            <span>{post.brand_display || "Reddit"}</span>
            <span>
              <strong>{post.title}</strong>
              <small>{post.text_snippet || post.context_window}</small>
            </span>
            <span>r/{post.subreddit || "unknown"}</span>
            <span className={post.sentiment_label || "neutral"}>{post.sentiment_label || "neutral"}</span>
            <span>
              <a href={post.url || "#"} target="_blank" rel="noreferrer">
                Open
              </a>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyChart({ posts }: { posts: Post[] }) {
  const rows = useMemo(() => {
    const map = new Map<string, { label: string; posts: number; sentiment: number }>();
    posts.forEach((post) => {
      const date = post.published_at ? new Date(post.published_at) : undefined;
      if (!date || Number.isNaN(date.getTime())) return;
      const key = date.toISOString().slice(0, 10);
      const current = map.get(key) || { label: date.toLocaleDateString("en-US", { weekday: "short" }), posts: 0, sentiment: 0 };
      current.posts += 1;
      current.sentiment += Number(post.sentiment_compound || 0);
      map.set(key, current);
    });
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, row]) => ({ ...row, sentiment: row.posts ? row.sentiment / row.posts : 0 }));
  }, [posts]);
  const chartRows = rows.length ? rows : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => ({ label, posts: 0, sentiment: 0 }));
  const maxPosts = Math.max(...chartRows.map((row) => row.posts), 1);
  return (
    <div className="dailyChart">
      {chartRows.map((row) => (
        <div key={row.label}>
          <i style={{ height: `${Math.max(4, (row.posts / maxPosts) * 100)}%` }} />
          <strong>{row.posts}</strong>
          <small>{row.label}</small>
        </div>
      ))}
    </div>
  );
}

function KeywordSentiment({ terms, zoom }: { terms: ClusterTerm[]; zoom: number }) {
  const maxMentions = Math.max(...terms.map((term) => term.mentions || 0), 1);
  return (
    <div className="keywordViewport">
      <div className="keywordRows" style={{ width: `${zoom * 100}%` }}>
        {terms.slice(0, 18).map((term) => {
          const x = Math.max(6, Math.min(96, ((term.mentions || 0) / maxMentions) * 92));
          const state = sentimentClass(term.sentiment);
          return (
            <div key={term.term}>
              <span>{term.term}</span>
              <i>
                <b className={state} style={{ left: `${x}%` }} />
              </i>
              <em className={state}>
                {term.mentions || 0} · {state}
              </em>
            </div>
          );
        })}
      </div>
    </div>
  );
}
