"use client";

import { useEffect, useMemo, useState } from "react";
import { BrandAvatar } from "./components/BrandAvatar";
import {
  LangProvider,
  useLang,
  dimensionLabel,
  dimensionHelper,
  momentumLabel,
  sentimentTag,
  sentimentTagText,
  type Lang,
  type TKey
} from "./i18n";

type SentimentKey = keyof typeof sentimentTagText;

type ClusterTerm = {
  term: string;
  entity_type?: string;
  mentions?: number;
  sentiment?: number;
};

type ClusterBrand = {
  brand_norm: string;
  brand_display: string;
  brand_signal_type?: string;
  mentions?: number;
  unique_posts?: number;
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
  momentum_percentile?: number;
  cross_community_percentile?: number;
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
  brand_norm: string;
  brand_display: string;
  aliases?: string[];
  brand_signal_type?: string;
  mentions: number;
  unique_posts: number;
  cluster_count: number;
  avg_sentiment?: number;
  google_search_url?: string;
  logo_url?: string;
};

type ClusterBrandSignal = {
  week_start: string;
  cluster_id: string;
  cluster_name: string;
  brand_norm: string;
  brand_display: string;
  brand_signal_type: string;
  unique_posts: number;
  mentions: number;
  avg_sentiment?: number;
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
    weekly_post_count: number;
    weekly_brand_signal_count: number;
    weekly_unique_brand_count: number;
    verified_brand_count: number;
    known_brand_count: number;
    candidate_brand_count: number;
    term_signal_count?: number;
    avg_trend_score: number;
    max_trend_score?: number;
  };
  clusters: Cluster[];
  keywords: Keyword[];
  brands: Brand[];
  cluster_brand_signals: ClusterBrandSignal[];
  posts: Post[];
  weeks: string[];
};

type View = "home" | "explore" | "dashboard";
type ExploreTab = "trend" | "opportunity" | "mapping" | "sparkle" | "evidence";

const scoreOptions = [
  { key: "trend_score" },
  { key: "momentum_score" },
  { key: "sentiment_score" },
  { key: "cross_community_score" },
  { key: "engagement_score" }
] as const;

type ScoreKey = (typeof scoreOptions)[number]["key"];

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

function brandTypeLabel(type: string | undefined, lang: Lang) {
  if (type === "confirmed_whitelist_brand") return lang === "zh" ? "白名单品牌" : "Verified Brand";
  if (type === "catalog_known_brand") return lang === "zh" ? "已知品牌" : "Known Brand";
  return lang === "zh" ? "候选品牌" : "Emerging Candidate";
}

function brandTypeClass(type?: string) {
  if (type === "confirmed_whitelist_brand") return "verified";
  if (type === "catalog_known_brand") return "known";
  return "candidate";
}

function sentimentClass(value?: number | string) {
  if (typeof value === "string") return value || "neutral";
  if (Number(value || 0) >= 0.15) return "positive";
  if (Number(value || 0) <= -0.08) return "negative";
  return "neutral";
}

function sentimentValue(value: number | undefined, lang: Lang, t: (key: TKey) => string) {
  const score = Number(value || 0);
  const tag = sentimentClass(score);
  return (
    <span className={`sentimentTag ${tag}`}>
      {score >= 0 ? "+" : ""}
      {fmt(score, 2)} · {sentimentTag(lang, tag as SentimentKey)}
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

function spikeValue(cluster: Cluster, t: (key: TKey) => string): string {
  const ratio = spikeRatio(cluster);
  return ratio === null ? t("newRatioLabel") : `${fmt(ratio, 1)}x`;
}

function spikeLabel(cluster: Cluster, t: (key: TKey) => string): string {
  return `${t("spikeWord")}: ${spikeValue(cluster, t)}`;
}

function dimensionRawValue(cluster: Cluster, key: ScoreKey, lang: Lang, t: (key: TKey) => string) {
  if (key === "momentum_score") return <span className="rawValue">{cluster.current_week_posts} {t("postsUnit")} · {spikeLabel(cluster, t)}</span>;
  if (key === "engagement_score") return <span className="rawValue">{fmt(cluster.avg_log_engagement, 2)} {t("engagementUnit")}</span>;
  if (key === "cross_community_score") return <span className="rawValue">{cluster.unique_subreddits} {t("subredditsUnit")}</span>;
  if (key === "sentiment_score") return sentimentValue(cluster.avg_sentiment, lang, t);
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

type MomentumTag = {
  labelKey: "emerging" | "exploding" | "highEngagement" | "broadAdoption" | "risk" | "steady";
  tone: "opportunity" | "engagement" | "broad" | "risk" | "steady";
};

// Numeric scores stay available in every detail view (Dashboard, category stat grid); this
// is an additional at-a-glance read for list rows, not a replacement for the underlying data.
function momentumTag(cluster: Cluster): MomentumTag {
  if (Number(cluster.previous_week_posts || 0) === 0) return { labelKey: "emerging", tone: "opportunity" };
  if (Number(cluster.growth_rate || 0) >= 2) return { labelKey: "exploding", tone: "opportunity" };
  if (Number(cluster.momentum_score || 0) >= 4) return { labelKey: "highEngagement", tone: "engagement" };
  if (Number(cluster.cross_community_score || 0) >= 4) return { labelKey: "broadAdoption", tone: "broad" };
  if (Number(cluster.sentiment_score || 0) <= 2) return { labelKey: "risk", tone: "risk" };
  return { labelKey: "steady", tone: "steady" };
}

function TagPill({ tag }: { tag: MomentumTag }) {
  const { lang } = useLang();
  return <span className={`tag tag-${tag.tone}`}>{momentumLabel(lang, tag.labelKey)}</span>;
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
    .sort((a, b) => Number(b.mentions || 0) - Number(a.mentions || 0));
}

export default function RadarApp() {
  return (
    <LangProvider>
      <RadarAppInner />
    </LangProvider>
  );
}

function RadarAppInner() {
  const { lang, setLang, t } = useLang();
  const [data, setData] = useState<DashboardBundle | null>(null);
  const [view, setView] = useState<View>("home");
  const [tab, setTab] = useState<ExploreTab>("trend");
  const [sortBy, setSortBy] = useState<ScoreKey>("trend_score");
  const [selectedClusterId, setSelectedClusterId] = useState<string>("");
  const [onlyBrand, setOnlyBrand] = useState(true);
  const [brandQuery, setBrandQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedSignalKey, setSelectedSignalKey] = useState("");
  const [opportunityZoom, setOpportunityZoom] = useState(1);
  const [opportunityDrag, setOpportunityDrag] = useState(0);
  const [dashboardCategoryId, setDashboardCategoryId] = useState("all");
  const [sparkleCategoryId, setSparkleCategoryId] = useState("all");
  const [selectedWeek, setSelectedWeek] = useState("");
  const [brandTypeFilter, setBrandTypeFilter] = useState("trusted");
  const [brandSort, setBrandSort] = useState<"priority" | "discussed">("priority");

  function loadWeek(week: string) {
    const path = week ? `/data/dashboard-${week}.json` : "/data/dashboard.json";
    fetch(path, { cache: "no-store" })
      .then((response) => response.json())
      .then((bundle: DashboardBundle) => {
        setData(bundle);
        setSelectedWeek(bundle.meta.latest_week);
        setSelectedClusterId(bundle.clusters[0]?.cluster_id || "");
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  }

  useEffect(() => {
    loadWeek("");
  }, []);

  // The switcher only offers the 3 most recent weeks, even if more are available in
  // data.weeks -- older weeks stay reachable by editing the URL-less dashboard-<week>.json
  // files directly, but the topbar control is intentionally kept to a short, current list.
  const recentWeeks = (data?.weeks || []).slice(0, 3);

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
    const keywordItems = data.keywords.map((item) => ({
        key: `keyword:${item.term.toLowerCase()}`,
        kind: "keyword" as const,
        display: item.term,
        cluster_id: item.cluster_id,
        cluster_name: item.cluster_name,
        mentions: item.mentions,
        sentiment: item.sentiment || 0,
        tag: item.entity_type || "keyword",
        url: "",
        uniquePosts: 0,
        clusterCount: 1,
        clusterSignals: [] as ClusterBrandSignal[],
        aliases: [] as string[]
      }));
    const brandItems = data.brands.map((item) => ({
        key: `brand:${item.brand_norm}`,
        kind: "brand" as const,
        display: item.brand_display,
        mentions: item.mentions,
        uniquePosts: item.unique_posts,
        clusterCount: item.cluster_count,
        sentiment: item.avg_sentiment || 0,
        tag: item.brand_signal_type || "candidate_non_whitelist_brand",
        url: item.google_search_url || googleBrandUrl(item.brand_display),
        logoUrl: item.logo_url || "",
        aliases: item.aliases || [],
        clusterSignals: data.cluster_brand_signals.filter((signal) => signal.brand_norm === item.brand_norm)
      }));
    const typeAllowed = (type: string) => brandTypeFilter === "all"
      || (brandTypeFilter === "trusted" && type !== "candidate_non_whitelist_brand")
      || type === brandTypeFilter;
    const filteredBrands = brandItems
      .filter((item) => typeAllowed(item.tag))
      .filter((item) => !selectedCategory || item.clusterSignals.some((signal) => signal.cluster_name.toLowerCase() === selectedCategory))
      .filter((item) => !query || [item.display, item.key.slice(6), ...item.aliases].some((value) => value.toLowerCase().includes(query)));
    const typePriority = (type: string) => type === "confirmed_whitelist_brand" ? 0 : type === "catalog_known_brand" ? 1 : 2;
    filteredBrands.sort((a, b) => brandSort === "priority"
      ? typePriority(a.tag) - typePriority(b.tag) || b.uniquePosts - a.uniquePosts || b.mentions - a.mentions
      : b.uniquePosts - a.uniquePosts || b.mentions - a.mentions);
    if (onlyBrand) return filteredBrands;
    return [...filteredBrands, ...keywordItems.filter((item) => !selectedCategory || item.cluster_name.toLowerCase() === selectedCategory)]
      .sort((a, b) => b.mentions - a.mentions);
  }, [brandQuery, brandSort, brandTypeFilter, categoryFilter, data, onlyBrand]);

  useEffect(() => {
    if (signalCards.length && !signalCards.some((item) => item.key === selectedSignalKey)) {
      setSelectedSignalKey(signalCards[0].key);
    }
  }, [selectedSignalKey, signalCards]);

  if (!data || !selectedCluster) {
    return <main className="shell loading">{t("loading")}</main>;
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
          {t("brandName")}
        </button>
        <nav>
          {(["home", "explore", "dashboard"] as View[]).map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
              {item === "home" ? t("navHome") : item === "explore" ? t("navExplore") : t("navAnalytics")}
            </button>
          ))}
        </nav>
        <div className="topActions">
          <div className="langSwitch">
            {(["en", "zh"] as Lang[]).map((option) => (
              <button key={option} className={lang === option ? "active" : ""} onClick={() => setLang(option)}>
                {option === "en" ? "EN" : "中文"}
              </button>
            ))}
          </div>
          <select
            className="weekSelect"
            value={selectedWeek}
            onChange={(event) => loadWeek(event.target.value)}
            aria-label={t("weekAria")}
          >
            {recentWeeks.map((week) => (
              <option key={week} value={week}>
                {formatWeekRange(week)}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={() => window.print()}>
            {t("exportBtn")}
          </button>
        </div>
      </header>

      {view === "home" && <Home data={data} setView={setView} />}

      {view === "explore" && (
        <section>
          <SectionHeader
            kicker={t("exploreSectionKicker")}
            title={t("exploreSectionTitle")}
            body={t("exploreSectionBody")}
          />
          <div className="tabs">
            {[
              ["trend", t("tabTrend")],
              ["opportunity", t("tabOpportunity")],
              ["mapping", t("tabMapping")],
              ["sparkle", t("tabSparkle")]
            ].map(([key, label], index) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key as ExploreTab)}
              >
                <small>{t("tabWord")} {index + 1}</small>
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
              brandTypeFilter={brandTypeFilter}
              brandSort={brandSort}
              setOnlyBrand={setOnlyBrand}
              setBrandQuery={setBrandQuery}
              setCategoryFilter={setCategoryFilter}
              setBrandTypeFilter={setBrandTypeFilter}
              setBrandSort={setBrandSort}
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
  const { t } = useLang();
  return (
    <section className="hero">
      <div className="eyebrow">{t("heroEyebrow")}</div>
      <h1>{t("heroTitle")}</h1>
      <p>{t("heroBody")}</p>
      <div className="stats">
        <Stat label={t("statAnalysisWeek")} value={formatWeekRange(data.meta.latest_week)} compactValue />
        <Stat label={t("statWeeklyDiscussionPosts")} value={data.meta.weekly_post_count.toLocaleString()} />
        <Stat label={t("statWeeklyBrandSignals")} value={data.meta.weekly_brand_signal_count.toLocaleString()} />
      </div>
      <div className="routeCards">
        <button onClick={() => setView("explore")}>
          <span>{t("exploreCardKicker")}</span>
          <strong>{t("exploreCardTitle")}</strong>
          <small>{t("exploreCardBody")}</small>
          <em className="routeCardTag">{t("exploreCardTag")}</em>
        </button>
        <button onClick={() => setView("dashboard")}>
          <span>{t("dashboardCardKicker")}</span>
          <strong>{t("dashboardCardTitle")}</strong>
          <small>{t("dashboardCardBody")}</small>
          <em className="routeCardTag">{t("dashboardCardTag")}</em>
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value, compactValue = false }: { label: string; value: string; compactValue?: boolean }) {
  return (
    <div>
      <strong className={compactValue ? "compactValue" : ""}>{value}</strong>
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
  const { lang, t } = useLang();
  const [brandLimit, setBrandLimit] = useState(20);
  useEffect(() => setBrandLimit(20), [selectedCluster.cluster_id]);
  const clusterBrands = [...selectedCluster.brands].sort(
    (a, b) => Number(b.unique_posts || 0) - Number(a.unique_posts || 0) || Number(b.mentions || 0) - Number(a.mentions || 0)
  );
  return (
    <div className="trendGrid">
      <article className="panel wide">
        <div className="panelHeader">
          <span>{t("dimPanelKicker")}</span>
          <h3>{t("dimPanelTitle")}</h3>
        </div>
        <div className="dimensionFilters">
          {scoreOptions.map((option) => (
            <button key={option.key} className={sortBy === option.key ? "active" : ""} onClick={() => setSortBy(option.key)}>
              <strong>{dimensionLabel(lang, option.key)}</strong>
              <small>{dimensionHelper(lang, option.key)}</small>
            </button>
          ))}
        </div>
      </article>
      <article className="panel">
        <div className="panelHeader">
          <span>{t("rankKicker")}</span>
          <h3>{t("rankTitle")}</h3>
        </div>
        <div className="clusterList">
          {clusters.map((cluster, index) => (
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
                  {cluster.current_week_posts} {t("postsUnit")} · {cluster.unique_subreddits} {t("subsUnit")} · {t("sortedBy")} {dimensionLabel(lang, sortBy)}
                </small>
                <TagPill tag={momentumTag(cluster)} />
              </span>
            </button>
          ))}
        </div>
      </article>
      <article className="panel">
        <div className="panelHeader">
          <span>{t("detailKicker")}</span>
          <h3>{selectedCluster.cluster_name}</h3>
        </div>
        <div className="starStack">
          {scoreOptions.map((option) => (
            <div key={option.key}>
              <span>{dimensionLabel(lang, option.key)}</span>
              {option.key === "sentiment_score" ? sentimentValue(selectedCluster.avg_sentiment, lang, t) : starRating(Number(selectedCluster[option.key]))}
            </div>
          ))}
        </div>
        <h4>{t("activeSources")}</h4>
        <div className="sourceGrid">
          {subredditSources(posts).map((source) => (
            <a key={source.subreddit} href={`https://www.reddit.com/r/${source.subreddit}`} target="_blank" rel="noreferrer">
              <b>r/{source.subreddit}</b>
              <small>{source.posts} {t("postsUnit")}</small>
            </a>
          ))}
        </div>
        <h4>{t("topicLandscape")}</h4>
        <div className="wordCloud">
          {selectedCluster.terms.map((term) => (
            <button key={term.term} className={sentimentClass(term.sentiment)}>
              {term.term}
            </button>
          ))}
        </div>
        <h4>{t("relatedBrandsKeywords")}</h4>
        <div className="productCards">
          {[...clusterBrands.slice(0, brandLimit).map((item) => ({ type: "brand", id: item.brand_norm, name: item.brand_display, signalType: item.brand_signal_type, tag: brandTypeLabel(item.brand_signal_type, lang), uniquePosts: item.unique_posts || 0, mentions: item.mentions || 0, url: item.google_search_url || googleBrandUrl(item.brand_display), logoUrl: item.logo_url || "" })), ...selectedCluster.terms.map((item) => ({ type: "keyword", id: item.term, name: item.term, signalType: "", tag: item.entity_type || "keyword", uniquePosts: 0, mentions: item.mentions || 0, url: "", logoUrl: "" }))].map((item) => (
            <div key={`${item.type}-${item.id}`}>
              {item.type === "brand" ? <BrandAvatar name={item.name} logoUrl={item.logoUrl} size="md" /> : <i className="keywordAvatar">#</i>}
              <span className="productCardText">
                <b>{item.name}</b>
                <small>
                  <span className={`brandTypeBadge ${brandTypeClass(item.signalType)}`}>{item.tag}</span> · {item.type === "brand" ? `${item.uniquePosts} ${t("postsUnit")} · ` : ""}{item.mentions} {t("mentionsUnit")}
                </small>
              </span>
              <span className="productCardActions">
                {item.type === "brand" && (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {t("learnMoreBrand")}
                  </a>
                )}
                <button onClick={() => setTab("evidence")}>{t("evidenceBtn")}</button>
              </span>
            </div>
          ))}
          {clusterBrands.length > brandLimit && <button className="loadMore" onClick={() => setBrandLimit((value) => value + 20)}>{t("loadMore")}</button>}
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
  const { t } = useLang();
  const maxPosts = Math.max(...clusters.map((cluster) => cluster.current_week_posts), 1);
  const maxSubreddits = Math.max(...clusters.map((cluster) => cluster.unique_subreddits), 1);
  const maxTrend = Math.max(...clusters.map((cluster) => cluster.trend_score), 1);
  const dragOffset = (drag / 100) * (zoom - 1) * 100;
  const broad = [...clusters].sort(
    (a, b) => b.momentum_score + b.cross_community_score - (a.momentum_score + a.cross_community_score)
  );
  const niche = [...clusters].sort(
    (a, b) => b.momentum_score - b.cross_community_score - (a.momentum_score - a.cross_community_score)
  );
  return (
    <div className="singleColumn">
      <article className="panel">
        <div className="panelHeader">
          <span>{t("quadrantKicker")}</span>
          <h3>{t("quadrantTitle")}</h3>
        </div>
        <div className="axisControls">
          <label>
            {t("xZoom")}
            <input type="range" min="1" max="3" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            <em>{fmt(zoom, 1)}x</em>
          </label>
          <label>
            {t("dragRight")}
            <input type="range" min="0" max="100" step="1" value={drag} onChange={(event) => setDrag(Number(event.target.value))} />
            <em>{Math.round(drag)}%</em>
          </label>
        </div>
        <div className="scatter">
          <div className="scatterCanvas" style={{ width: `${zoom * 100}%`, transform: `translateX(-${dragOffset}%)` }}>
            <span className="axis top">{t("axisHighMomentum")}</span>
            <span className="axis right">{t("axisReach")}</span>
            {clusters.map((cluster) => {
              // Absolute values (not percentile rank) per request: x = raw discussion
              // volume (current_week_posts), y = raw cross-community reach (unique_subreddits).
              // Bubble size still carries a third dimension (trend_score) now that
              // post count moved from size onto the x-axis.
              const x = 6 + Math.max(0, Math.min(1, cluster.current_week_posts / maxPosts)) * 88;
              const y = 6 + Math.max(0, Math.min(1, cluster.unique_subreddits / maxSubreddits)) * 88;
              const size = 16 + 34 * (cluster.trend_score / maxTrend);
              return (
                <div key={cluster.cluster_id} className="scatterPoint" style={{ left: `${x}%`, bottom: `${y}%` }}>
                  <button
                    className={selectedClusterId === cluster.cluster_id ? "active" : ""}
                    title={cluster.cluster_name}
                    style={{ width: size, height: size }}
                    onClick={() => openClusterDetail(cluster.cluster_id)}
                  />
                  <span className="scatterLabel">{cluster.cluster_name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </article>
      <article className="panel">
        <div className="opportunityLists">
          <OpportunityList title={t("listHighHigh")} rows={broad} openClusterDetail={openClusterDetail} />
          <OpportunityList title={t("listHighLow")} rows={niche} openClusterDetail={openClusterDetail} />
        </div>
      </article>
    </div>
  );
}

function OpportunityList({ title, rows, openClusterDetail }: { title: string; rows: Cluster[]; openClusterDetail: (id: string) => void }) {
  const { t } = useLang();
  return (
    <div className="opportunityListColumn">
      <h4>{title}</h4>
      <div className="opportunityListRows">
        {rows.map((cluster, index) => (
          <button key={cluster.cluster_id} className="opportunityRow" onClick={() => openClusterDetail(cluster.cluster_id)}>
            <b>#{index + 1}</b>
            <span>
              <strong>{cluster.cluster_name}</strong>
              <small>
                {cluster.current_week_posts} {t("postsUnit")} · {cluster.unique_subreddits} {t("subredditsUnit")}
              </small>
              <TagPill tag={momentumTag(cluster)} />
            </span>
            <em>›</em>
          </button>
        ))}
      </div>
    </div>
  );
}

type SignalCard = {
  key: string;
  kind: "keyword" | "brand";
  display: string;
  mentions: number;
  uniquePosts: number;
  clusterCount: number;
  sentiment: number;
  tag: string;
  clusterSignals: ClusterBrandSignal[];
  aliases: string[];
  url: string;
  logoUrl?: string;
  cluster_id?: string;
  cluster_name?: string;
};

function MappingTab({
  clusters,
  signalCards,
  selectedSignalKey,
  onlyBrand,
  brandQuery,
  categoryFilter,
  brandTypeFilter,
  brandSort,
  setOnlyBrand,
  setBrandQuery,
  setCategoryFilter,
  setBrandTypeFilter,
  setBrandSort,
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
  brandTypeFilter: string;
  brandSort: "priority" | "discussed";
  setOnlyBrand: (value: boolean) => void;
  setBrandQuery: (value: string) => void;
  setCategoryFilter: (value: string) => void;
  setBrandTypeFilter: (value: string) => void;
  setBrandSort: (value: "priority" | "discussed") => void;
  setSelectedSignalKey: (value: string) => void;
  setSelectedClusterId: (value: string) => void;
  setTab: (tab: ExploreTab) => void;
}) {
  const { lang, t } = useLang();
  const selected = signalCards.find((item) => item.key === selectedSignalKey) || signalCards[0];
  const [visibleCount, setVisibleCount] = useState(20);
  useEffect(() => setVisibleCount(20), [brandQuery, brandSort, brandTypeFilter, categoryFilter, onlyBrand]);
  return (
    <div className="mappingGrid">
      <article className="panel">
        <div className="panelHeader">
          <span>{t("signalDetailKicker")}</span>
          <h3>{t("signalDetailTitle")}</h3>
        </div>
        <div className="filters">
          <button className={onlyBrand ? "active" : ""} onClick={() => setOnlyBrand(!onlyBrand)}>
            {t("onlyBrand")}
          </button>
          <input value={brandQuery} onChange={(event) => setBrandQuery(event.target.value)} placeholder={t("searchBrandPlaceholder")} />
          <input list="category-list" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} placeholder={t("allCategoriesPlaceholder")} />
          <select value={brandTypeFilter} onChange={(event) => setBrandTypeFilter(event.target.value)}>
            <option value="trusted">{t("trustedBrands")}</option>
            <option value="all">{t("allBrands")}</option>
            <option value="confirmed_whitelist_brand">{t("verifiedBrands")}</option>
            <option value="catalog_known_brand">{t("knownBrands")}</option>
            <option value="candidate_non_whitelist_brand">{t("candidateBrands")}</option>
          </select>
          <select value={brandSort} onChange={(event) => setBrandSort(event.target.value as "priority" | "discussed")}>
            <option value="priority">{t("businessPriority")}</option>
            <option value="discussed">{t("mostDiscussed")}</option>
          </select>
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
          {signalCards.slice(0, visibleCount).map((item, index) => (
            <button key={item.key} className={selected?.key === item.key ? "active" : ""} onClick={() => setSelectedSignalKey(item.key)}>
              <b>#{index + 1}</b>
              <strong>{item.display}</strong>
              <span className={`brandTypeBadge ${brandTypeClass(item.tag)}`}>{item.kind === "brand" ? brandTypeLabel(item.tag, lang) : item.tag}</span>
              <small>{item.kind === "brand" ? `${item.uniquePosts} ${t("postsUnit")} · ${item.mentions} ${t("mentionsUnit")} · ${item.clusterCount} ${t("categoriesUnit")}` : `${item.mentions} ${t("mentionsUnit")}`}</small>
            </button>
          ))}
          {signalCards.length > visibleCount && <button className="loadMore" onClick={() => setVisibleCount((value) => value + 20)}>{t("loadMore")}</button>}
        </div>
      </article>
      <article className="panel stickyPanel">
        <div className="panelHeader">
          <span>{t("selectedSignalKicker")}</span>
          <h3>{selected?.display || t("chooseSignal")}</h3>
        </div>
        {selected && (
          <div className="signalDetail">
            <div className={`signalHero signalHero-${selected.kind}`}>
              {selected.kind === "brand" ? <BrandAvatar name={selected.display} logoUrl={selected.logoUrl} size="lg" /> : <i>#</i>}
              <span>
                <strong>{selected.display}</strong>
                <small>{selected.kind === "brand" ? t("brandSignalLabel") : t("keywordPhraseLabel")}</small>
              </span>
            </div>
            <div className="metricGrid">
              <Stat label={t("discussionPosts")} value={`${selected.uniquePosts} ${t("postsUnit")}`} />
              <Stat label={t("statFrequency")} value={`${selected.mentions} ${t("mentionsUnit")}`} />
              <Stat label={t("statSentiment")} value={sentimentTag(lang, sentimentClass(selected.sentiment) as SentimentKey)} />
              <Stat label={t("statTag")} value={selected.kind === "brand" ? brandTypeLabel(selected.tag, lang) : selected.tag} />
              <Stat label={t("statAppearsIn")} value={`${selected.clusterCount} ${t("categoriesUnit")}`} />
            </div>
            <h4>{t("categoriesHeading")}</h4>
            <div className="chips">
              {selected.clusterSignals.map((signal) => (
                <button
                  key={`${signal.cluster_id}:${selected.key}`}
                  onClick={() => {
                    setSelectedClusterId(signal.cluster_id);
                    setTab("trend");
                  }}
                >
                  {signal.cluster_name} · {signal.unique_posts} {t("postsUnit")} · {signal.mentions} {t("mentionsUnit")}
                </button>
              ))}
            </div>
            {selected.kind === "brand" && (
              <a className="primaryLink" href={selected.url} target="_blank" rel="noreferrer">
                {t("learnMoreBrand")}
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
  const { lang, t } = useLang();
  const fresh = clusters
    .filter((cluster) => cluster.previous_week_posts === 0)
    .filter((cluster) => sparkleCategoryId === "all" || cluster.cluster_id === sparkleCategoryId)
    .sort((a, b) => b.current_week_posts - a.current_week_posts);
  const newBrands = [...brands]
    .filter((brand) => sparkleCategoryId === "all" || selectedCluster.brands.some((item) => item.brand_norm === brand.brand_norm))
    .sort((a, b) => Number(b.unique_posts || 0) - Number(a.unique_posts || 0) || Number(b.mentions || 0) - Number(a.mentions || 0));
  return (
    <div className="mappingGrid">
      <article className="panel wide filterPanel">
        <label>
          {t("categoryFilter")}
          <select
            value={sparkleCategoryId}
            onChange={(event) => {
              setSparkleCategoryId(event.target.value);
              if (event.target.value !== "all") setSelectedClusterId(event.target.value);
            }}
          >
            <option value="all">{t("overallAllCategories")}</option>
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
          <span>{t("freshKicker")}</span>
          <h3>{t("freshTitle")}</h3>
        </div>
        <div className="sparkleList">
          <div className="sparkleGroup">
            <h4>{t("newCategories")}</h4>
            {fresh.map((cluster) => (
              <button
                key={cluster.cluster_id}
                onClick={() => {
                  setSelectedClusterId(cluster.cluster_id);
                  setTab("trend");
                }}
              >
                <b>{t("newTag")}</b>
                <span>
                  <strong>{cluster.cluster_name}</strong>
                  <small>
                    {cluster.current_week_posts} {t("postsUnit")} · {cluster.unique_subreddits} {t("subredditsUnit")}
                  </small>
                </span>
                <em>›</em>
              </button>
            ))}
          </div>
          <div className="sparkleGroup">
            <h4>{t("newBrandSignals")}</h4>
            {newBrands.map((brand) => (
              <button
                key={brand.brand_norm}
                onClick={() => {
                  if (sparkleCategoryId !== "all") setSelectedClusterId(sparkleCategoryId);
                  setSelectedSignalKey(`brand:${brand.brand_norm}`);
                  setOnlyBrand(true);
                  setTab("mapping");
                }}
              >
                <BrandAvatar name={brand.brand_display} logoUrl={brand.logo_url} size="md" />
                <span>
                  <strong>{brand.brand_display}</strong>
                  <small>{brand.mentions} {t("mentionsUnit")} · {brandTag(brand.brand_signal_type)}</small>
                </span>
                <em>›</em>
              </button>
            ))}
          </div>
        </div>
      </article>
      <article className="panel">
        <div className="panelHeader">
          <span>{t("selectedSignalKicker")}</span>
          <h3>{selectedCluster.cluster_name}</h3>
        </div>
        <div className="starStack">
          <div>
            <span>{t("firstWeekPosts")}</span>
            <strong>{selectedCluster.current_week_posts}</strong>
          </div>
          <div>
            <span>{t("statSentiment")}</span>
            {sentimentValue(selectedCluster.avg_sentiment, lang, t)}
          </div>
          <div>
            <span>{t("spike")}</span>
            <strong>{spikeValue(selectedCluster, t)}</strong>
          </div>
          <div>
            <span>{t("subreddits")}</span>
            <strong>{selectedCluster.unique_subreddits}</strong>
          </div>
        </div>
        <h4>{t("freshKeywords")}</h4>
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
  const { t } = useLang();
  return (
    <article className="panel">
      <div className="panelHeader splitHeader">
        <span>{t("evidenceKicker")}</span>
        <h3>{cluster.cluster_name} · {t("evidenceTitleSuffix")}</h3>
        <button className="ghost" onClick={() => setTab("trend")}>
          {t("backToCategory")}
        </button>
      </div>
      <div className="evidenceGrid">
        {posts.map((post, index) => (
          <article key={`${post.url || post.title}-${index}`}>
            <div>
              <strong>{post.title}</strong>
              <span>r/{post.subreddit || t("fallbackUnknown")}</span>
            </div>
            <p>{post.context_window || post.text_snippet}</p>
            <div>
              <span>
                {post.brand_display || t("fallbackReddit")} · {post.sentiment_label || "neutral"}
              </span>
              <a href={post.url || "#"} target="_blank" rel="noreferrer">
                {t("openReddit")}
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
  const { lang, t } = useLang();
  const dashboardCluster = dashboardCategoryId === "all"
    ? undefined
    : data.clusters.find((cluster) => cluster.cluster_id === dashboardCategoryId) || selectedCluster;
  const rawRows = dashboardCluster ? clusterPosts(data.posts, dashboardCluster.cluster_id) : data.posts;
  const dashboardTerms = dashboardCluster ? dashboardCluster.terms : aggregateTerms(data.keywords);
  const maxTrend = Math.max(...data.clusters.map((cluster) => cluster.trend_score), 1);
  return (
    <section>
      <SectionHeader
        kicker={t("vizKicker")}
        title={t("vizTitle")}
        body={t("vizBody")}
      />
      <div className="dashboardGrid">
        <article className="panel wide">
          <div className="panelHeader">
            <span>{t("overallKicker")}</span>
            <h3>{t("trendRankTitle")}</h3>
          </div>
          <div className="barChart">
            {data.clusters.map((cluster) => (
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
              <span>{dimensionLabel(lang, option.key)}</span>
              <h3>{dimensionLabel(lang, option.key)} {t("rankingSuffix")}</h3>
            </div>
            <div className="dimensionChart">
              {[...data.clusters]
                .sort((a, b) => Number(b[option.key]) - Number(a[option.key]))
                .map((cluster, index) => (
                  <button key={cluster.cluster_id} onClick={() => setSelectedClusterId(cluster.cluster_id)}>
                    <b>#{index + 1}</b>
                    <span>{cluster.cluster_name}</span>
                    <i>
                      <b style={{ width: `${Math.max(4, Number(cluster[option.key]) * 20)}%` }} />
                    </i>
                    <em>{dimensionRawValue(cluster, option.key, lang, t)}</em>
                  </button>
                ))}
            </div>
          </article>
        ))}
        <article className="panel wide rawPanel">
          <div className="panelHeader">
            <span>{t("rawDataKicker")}</span>
            <h3>{t("rawDataTitle")}</h3>
          </div>
          <RawTable rows={rawRows.length ? rawRows : data.posts.slice(0, 12)} />
        </article>
        <article className="panel wide filterPanel">
          <label>
            {t("categoryFilter")}
            <select
              value={dashboardCategoryId}
              onChange={(event) => {
                setDashboardCategoryId(event.target.value);
                if (event.target.value !== "all") setSelectedClusterId(event.target.value);
              }}
            >
              <option value="all">{t("overallAllCategories")}</option>
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
            <span>{t("topicKicker")}</span>
            <h3>{t("wordCloudTitle")}</h3>
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
            <span>{t("weeklyTrendKicker")}</span>
            <h3>{t("dailyChartTitle")}</h3>
          </div>
          <DailyChart posts={rawRows} />
        </article>
        <article className="panel half">
          <div className="panelHeader">
            <span>{t("keywordSentimentKicker")}</span>
            <h3>{t("keywordSentimentTitle")}</h3>
          </div>
          <KeywordSentiment terms={dashboardTerms} zoom={1} />
        </article>
      </div>
    </section>
  );
}

function RawTable({ rows }: { rows: Post[] }) {
  const { t } = useLang();
  return (
    <div className="rawTable">
      <div className="rawHead">
        <span>{t("rawHeadBrandSignal")}</span>
        <span>{t("rawHeadPost")}</span>
        <span>{t("rawHeadSubreddit")}</span>
        <span>{t("rawHeadSentiment")}</span>
        <span>{t("rawHeadUrl")}</span>
      </div>
      <div className="rawBody">
        {rows.map((post, index) => (
          <div key={`${post.url || post.title}-${index}`} className="rawRow">
            <span>{post.brand_display || t("fallbackReddit")}</span>
            <span>
              <strong>{post.title}</strong>
              <small>{post.text_snippet || post.context_window}</small>
            </span>
            <span>r/{post.subreddit || t("fallbackUnknown")}</span>
            <span className={post.sentiment_label || "neutral"}>{post.sentiment_label || "neutral"}</span>
            <span>
              <a href={post.url || "#"} target="_blank" rel="noreferrer">
                {t("open")}
              </a>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const weekdayFallback = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  zh: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
} as const;

function DailyChart({ posts }: { posts: Post[] }) {
  const { lang } = useLang();
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const rows = useMemo(() => {
    const map = new Map<string, { label: string; posts: number; sentiment: number }>();
    posts.forEach((post) => {
      const date = post.published_at ? new Date(post.published_at) : undefined;
      if (!date || Number.isNaN(date.getTime())) return;
      const key = date.toISOString().slice(0, 10);
      const current = map.get(key) || { label: date.toLocaleDateString(locale, { weekday: "short" }), posts: 0, sentiment: 0 };
      current.posts += 1;
      current.sentiment += Number(post.sentiment_compound || 0);
      map.set(key, current);
    });
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, row]) => ({ ...row, sentiment: row.posts ? row.sentiment / row.posts : 0 }));
  }, [posts, locale]);
  const chartRows = rows.length ? rows : weekdayFallback[lang].map((label) => ({ label, posts: 0, sentiment: 0 }));
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
  const { lang } = useLang();
  const maxMentions = Math.max(...terms.map((term) => term.mentions || 0), 1);
  return (
    <div className="keywordViewport">
      <div className="keywordRows" style={{ width: `${zoom * 100}%` }}>
        {terms.map((term) => {
          const x = Math.max(6, Math.min(96, ((term.mentions || 0) / maxMentions) * 92));
          const state = sentimentClass(term.sentiment);
          return (
            <div key={term.term}>
              <span>{term.term}</span>
              <i>
                <b className={state} style={{ left: `${x}%` }} />
              </i>
              <em className={state}>
                {term.mentions || 0} · {sentimentTag(lang, state as SentimentKey)}
              </em>
            </div>
          );
        })}
      </div>
    </div>
  );
}
