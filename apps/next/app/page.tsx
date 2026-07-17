"use client";

import { useEffect, useMemo, useState } from "react";
import { BrandAvatar } from "./components/BrandAvatar";
import { CategoryAvatar } from "./components/CategoryAvatar";
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
  term_norm: string;
  entity_type?: string;
  mentions?: number;
  unique_posts?: number;
  sentiment?: number;
};

type ClusterCommunity = {
  subreddit: string;
  unique_posts: number;
  discussion_share: number;
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
  illustration_url?: string;
  trend_score: number;
  trend_score_100: number;
  momentum_score: number;
  sentiment_score: number;
  cross_community_score: number;
  engagement_score: number;
  momentum_percentile?: number;
  cross_community_percentile?: number;
  current_week_posts: number;
  keyword_signal_count?: number;
  brand_signal_count?: number;
  previous_week_posts: number;
  growth_rate: number;
  unique_subreddits: number;
  avg_sentiment?: number;
  positive_share?: number;
  avg_log_engagement?: number;
  communities: ClusterCommunity[];
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
  unique_posts?: number;
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
  post_key?: string;
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
  matched_display?: string;
};

type SparkleCluster = {
  cluster_id: string;
  cluster_name: string;
  current_week_posts: number;
  unique_subreddits: number;
};

type SparkleSignal = {
  kind: "brand" | "keyword";
  cluster_id: string;
  cluster_name: string;
  signal_norm: string;
  display: string;
  source_type: string;
  ui_tag: "verified_brand" | "brand_keyword";
  unique_posts: number;
  mentions: number;
  avg_sentiment: number;
  logo_url?: string;
};

type SparkleData = {
  status: "ready" | "insufficient_comparison_weeks";
  current_week: string;
  comparison_weeks: string[];
  newly_active_clusters: SparkleCluster[];
  new_signals: SparkleSignal[];
};

type DashboardBundle = {
  meta: {
    latest_week: string;
    cluster_count: number;
    post_count: number;
    brand_signal_count: number;
    weekly_post_count: number;
    weekly_keyword_signal_count: number;
    weekly_brand_signal_count: number;
    covered_cluster_count: number;
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
  sparkle: SparkleData;
  posts: Post[];
  weeks: string[];
};

type DashboardWireBundle = Omit<DashboardBundle, "keywords"> & {
  keywords?: Keyword[];
  keywords_url?: string;
};

type KeywordBundle = {
  week_start: string;
  keywords: Keyword[];
};

type OpsTeam2Option = { ops_team_2: string; identity_key: string; categories: string[] };
type OpsTeamMapping = { ops_team_1: string; ops_team_2_options: OpsTeam2Option[] };
type OpsMapping = { version: number; ops_teams: OpsTeamMapping[]; pairs: OpsTeam2Option[] };
type OpsIdentity = {
  identityKey: string;
  opsTeam1: string;
  opsTeam2: string;
  categoryNames: string[];
  mappingVersion: number;
};

const OPS_IDENTITY_STORAGE_KEY = "reddit-signal-radar-ops-identity";
const ALL_IDENTITY_KEY = "__all__::__all__";

function normalizeCategoryName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

type View = "identity" | "home" | "explore" | "dashboard";
type ExploreTab = "trend" | "opportunity" | "mapping" | "sparkle" | "evidence";

const scoreOptions = [
  { key: "trend_score" },
  { key: "momentum_score" },
  { key: "cross_community_score" },
  { key: "sentiment_score" },
  { key: "engagement_score" }
] as const;

type ScoreKey = (typeof scoreOptions)[number]["key"];

type EvidenceTarget =
  | { kind: "brand"; clusterId: string; brandNorm: string; display: string }
  | { kind: "keyword"; clusterId: string; termNorm: string; display: string };

function fmt(value: number | undefined, digits = 1) {
  return Number(value || 0).toFixed(digits);
}

function finite(value: number | undefined) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function compareClusters(a: Cluster, b: Cluster, sortBy: ScoreKey) {
  const nameOrder = a.cluster_name.localeCompare(b.cluster_name);
  if (sortBy === "momentum_score") {
    return finite(b.momentum_score) - finite(a.momentum_score)
      || finite(b.growth_rate) - finite(a.growth_rate)
      || b.current_week_posts - a.current_week_posts || nameOrder;
  }
  if (sortBy === "cross_community_score") {
    return finite(b.cross_community_score) - finite(a.cross_community_score)
      || b.unique_subreddits - a.unique_subreddits
      || b.current_week_posts - a.current_week_posts || nameOrder;
  }
  if (sortBy === "sentiment_score") {
    return finite(b.sentiment_score) - finite(a.sentiment_score)
      || finite(b.positive_share) - finite(a.positive_share)
      || b.current_week_posts - a.current_week_posts || nameOrder;
  }
  if (sortBy === "engagement_score") {
    return finite(b.engagement_score) - finite(a.engagement_score)
      || finite(b.avg_log_engagement) - finite(a.avg_log_engagement)
      || b.current_week_posts - a.current_week_posts || nameOrder;
  }
  return finite(b.trend_score) - finite(a.trend_score)
    || b.current_week_posts - a.current_week_posts || nameOrder;
}

function dimensionTag(cluster: Cluster, sortBy: ScoreKey, lang: Lang): { label: string; tone: string } {
  const zh = lang === "zh";
  if (sortBy === "trend_score") {
    if (cluster.trend_score >= 4.2) return { label: zh ? "综合高潜" : "High Potential", tone: "opportunity" };
    if (cluster.trend_score >= 3.5) return { label: zh ? "值得关注" : "Worth Watching", tone: "engagement" };
    if (cluster.trend_score >= 2.5) return { label: zh ? "稳定观察" : "Steady Watch", tone: "steady" };
    return { label: zh ? "风险信号" : "Risk Signal", tone: "risk" };
  }
  if (sortBy === "momentum_score") {
    if (cluster.previous_week_posts === 0 && cluster.current_week_posts >= 5) return { label: zh ? "新兴" : "Emerging", tone: "opportunity" };
    if (cluster.momentum_score >= 4.5 || finite(cluster.growth_rate) >= 1) return { label: zh ? "爆发增长" : "Exploding", tone: "opportunity" };
    if (cluster.momentum_score >= 4 || finite(cluster.growth_rate) >= 0.3) return { label: zh ? "快速上升" : "Fast Rising", tone: "engagement" };
    if (finite(cluster.growth_rate) < 0) return { label: zh ? "降温" : "Cooling", tone: "risk" };
    return { label: zh ? "平稳" : "Steady", tone: "steady" };
  }
  if (sortBy === "cross_community_score") {
    if (cluster.cross_community_score >= 4.5) return { label: zh ? "广泛扩散" : "Broadly Spreading", tone: "broad" };
    if (cluster.cross_community_score >= 4) return { label: zh ? "跨社区增长" : "Cross-community Growth", tone: "engagement" };
    if (cluster.cross_community_score <= 2.5) return { label: zh ? "传播有限" : "Limited Reach", tone: "risk" };
    return { label: zh ? "垂直集中" : "Vertically Concentrated", tone: "steady" };
  }
  if (sortBy === "sentiment_score") {
    if (cluster.sentiment_score >= 4.5) return { label: zh ? "高度正面" : "Highly Positive", tone: "broad" };
    if (cluster.sentiment_score >= 4) return { label: zh ? "整体正面" : "Positive Overall", tone: "engagement" };
    if (cluster.sentiment_score <= 2.5) return { label: zh ? "负面风险" : "Negative Risk", tone: "risk" };
    return { label: zh ? "中性" : "Neutral", tone: "steady" };
  }
  if (cluster.engagement_score >= 4.5) return { label: zh ? "高互动" : "High Engagement", tone: "opportunity" };
  if (cluster.engagement_score >= 4) return { label: zh ? "持续讨论" : "Sustained Discussion", tone: "engagement" };
  if (cluster.engagement_score <= 2.5) return { label: zh ? "低互动" : "Low Engagement", tone: "risk" };
  return { label: zh ? "一般互动" : "Moderate Engagement", tone: "steady" };
}

function dimensionContext(cluster: Cluster, sortBy: ScoreKey, lang: Lang, t: (key: TKey) => string) {
  if (sortBy === "momentum_score") {
    const growth = cluster.previous_week_posts === 0 ? (lang === "zh" ? "首次出现" : "New this week") : `${finite(cluster.growth_rate) >= 0 ? "+" : ""}${Math.round(finite(cluster.growth_rate) * 100)}% WoW`;
    return `${cluster.current_week_posts} ${t("postsUnit")} · ${growth}`;
  }
  if (sortBy === "cross_community_score") return `${cluster.unique_subreddits} ${t("communitiesUnit")}`;
  if (sortBy === "sentiment_score") return `${Math.round(finite(cluster.positive_share) * 100)}% ${t("positiveUnit")} · ${cluster.current_week_posts} ${t("postsUnit")}`;
  if (sortBy === "engagement_score") return `${cluster.current_week_posts} ${t("postsUnit")} · ${dimensionTag(cluster, sortBy, lang).label}`;
  return `${cluster.current_week_posts} ${t("postsUnit")} · ${cluster.unique_subreddits} ${t("communitiesUnit")}`;
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
    .map((term) => ({ term: term.term, term_norm: term.term.toLowerCase(), unique_posts: 0, mentions: term.mentions, sentiment: term.weightedSentiment / Math.max(term.mentions, 1) }))
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
  const [opsMapping, setOpsMapping] = useState<OpsMapping | null>(null);
  const [identity, setIdentity] = useState<OpsIdentity | null>(null);
  const [identityResolved, setIdentityResolved] = useState(false);
  const [identityInvalid, setIdentityInvalid] = useState(false);
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
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceTarget | null>(null);
  const [evidencePosts, setEvidencePosts] = useState<Post[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState("");

  function loadWeek(week: string) {
    const path = week ? `/data/dashboard-${week}.json` : "/data/dashboard.json";
    fetch(path, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Dashboard request failed (${response.status})`);
        return response.json() as Promise<DashboardWireBundle>;
      })
      .then(async (wireBundle): Promise<DashboardBundle> => {
        if (wireBundle.keywords) return wireBundle as DashboardBundle;
        if (!wireBundle.keywords_url) throw new Error("Dashboard bundle is missing keywords_url");
        const response = await fetch(wireBundle.keywords_url, { cache: "no-store" });
        if (!response.ok) throw new Error(`Keywords request failed (${response.status})`);
        const keywordBundle = (await response.json()) as KeywordBundle;
        if (keywordBundle.week_start !== wireBundle.meta.latest_week) {
          throw new Error("Dashboard and keyword bundles are for different weeks");
        }
        return { ...wireBundle, keywords: keywordBundle.keywords };
      })
      .then((bundle) => {
        setData(bundle);
        setSelectedWeek(bundle.meta.latest_week);
        setSelectedClusterId(bundle.clusters[0]?.cluster_id || "");
        setEvidenceTarget(null);
        setEvidencePosts([]);
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  }

  useEffect(() => {
    loadWeek("");
    fetch("/data/ops-team-category-mapping.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Operations mapping request failed (${response.status})`);
        return response.json();
      })
      .then((mapping: OpsMapping) => {
        setOpsMapping(mapping);
        const raw = window.localStorage.getItem(OPS_IDENTITY_STORAGE_KEY);
        if (raw) {
          try {
            const saved = JSON.parse(raw) as { identityKey?: string; mappingVersion?: number };
            const pair = mapping.ops_teams
              .flatMap((team) => team.ops_team_2_options.map((option) => ({ team, option })))
              .find(({ option }) => option.identity_key === saved.identityKey);
            if (saved.identityKey === ALL_IDENTITY_KEY && saved.mappingVersion === mapping.version) {
              setIdentity({
                identityKey: ALL_IDENTITY_KEY,
                opsTeam1: "All Teams",
                opsTeam2: "All Categories",
                categoryNames: [],
                mappingVersion: mapping.version
              });
              setView("home");
            } else if (pair && saved.mappingVersion === mapping.version) {
              setIdentity({
                identityKey: pair.option.identity_key,
                opsTeam1: pair.team.ops_team_1,
                opsTeam2: pair.option.ops_team_2,
                categoryNames: pair.option.categories,
                mappingVersion: mapping.version
              });
              setView("home");
            } else {
              window.localStorage.removeItem(OPS_IDENTITY_STORAGE_KEY);
              setIdentityInvalid(true);
              setView("identity");
            }
          } catch {
            window.localStorage.removeItem(OPS_IDENTITY_STORAGE_KEY);
            setIdentityInvalid(true);
            setView("identity");
          }
        } else {
          setView("identity");
        }
        setIdentityResolved(true);
      })
      .catch((error: unknown) => {
        console.error(error);
        setIdentityResolved(true);
      });
  }, []);

  // The switcher only offers the 3 most recent weeks, even if more are available in
  // data.weeks -- older weeks stay reachable by editing the URL-less dashboard-<week>.json
  // files directly, but the topbar control is intentionally kept to a short, current list.
  const recentWeeks = (data?.weeks || []).slice(0, 3);

  const allowedClusterIds = useMemo(() => {
    if (!data || !identity) return new Set<string>();
    if (identity.identityKey === ALL_IDENTITY_KEY) {
      return new Set(data.clusters.map((cluster) => String(cluster.cluster_id)));
    }
    const categoryNames = new Set(identity.categoryNames.map(normalizeCategoryName));
    return new Set(data.clusters
      .filter((cluster) => categoryNames.has(normalizeCategoryName(cluster.cluster_name)))
      .map((cluster) => String(cluster.cluster_id)));
  }, [data, identity]);
  const filteredClusters = useMemo(() => (data?.clusters || []).filter(
    (cluster) => allowedClusterIds.has(String(cluster.cluster_id))
  ), [allowedClusterIds, data]);
  const scopedData = useMemo<DashboardBundle | null>(() => {
    if (!data) return null;
    const signals = data.cluster_brand_signals.filter((signal) => allowedClusterIds.has(String(signal.cluster_id)));
    const brands = data.brands.flatMap((brand) => {
      const rows = signals.filter((signal) => signal.brand_norm === brand.brand_norm);
      if (!rows.length) return [];
      const mentions = rows.reduce((sum, row) => sum + Number(row.mentions || 0), 0);
      const sentimentWeight = rows.reduce((sum, row) => sum + Number(row.avg_sentiment || 0) * Math.max(Number(row.mentions || 0), 1), 0);
      return [{ ...brand,
        mentions,
        unique_posts: rows.reduce((sum, row) => sum + Number(row.unique_posts || 0), 0),
        cluster_count: new Set(rows.map((row) => row.cluster_id)).size,
        avg_sentiment: sentimentWeight / Math.max(mentions, 1)
      }];
    });
    const keywords = data.keywords.filter((keyword) => allowedClusterIds.has(String(keyword.cluster_id)));
    return {
      ...data,
      clusters: filteredClusters,
      keywords,
      brands,
      cluster_brand_signals: signals,
      sparkle: {
        ...data.sparkle,
        newly_active_clusters: data.sparkle.newly_active_clusters.filter(
          (cluster) => allowedClusterIds.has(String(cluster.cluster_id))
        ),
        new_signals: data.sparkle.new_signals.filter(
          (signal) => allowedClusterIds.has(String(signal.cluster_id))
        )
      },
      posts: data.posts.filter((post) => allowedClusterIds.has(String(post.cluster_id))),
      meta: {
        ...data.meta,
        weekly_post_count: filteredClusters.reduce((sum, cluster) => sum + Number(cluster.current_week_posts || 0), 0),
        weekly_keyword_signal_count: filteredClusters.reduce((sum, cluster) => sum + Number(cluster.keyword_signal_count || 0), 0),
        weekly_brand_signal_count: filteredClusters.reduce((sum, cluster) => sum + Number(cluster.brand_signal_count || 0), 0),
        covered_cluster_count: filteredClusters.filter((cluster) => cluster.current_week_posts > 0).length,
        cluster_count: filteredClusters.length
      }
    };
  }, [allowedClusterIds, data, filteredClusters]);

  const clusters = useMemo(() => [...filteredClusters].sort((a, b) => compareClusters(a, b, sortBy)), [filteredClusters, sortBy]);

  const selectedCluster = useMemo(() => {
    if (!filteredClusters.length) return undefined;
    return filteredClusters.find((cluster) => cluster.cluster_id === selectedClusterId) || filteredClusters[0];
  }, [filteredClusters, selectedClusterId]);

  useEffect(() => {
    if (filteredClusters.length && !allowedClusterIds.has(String(selectedClusterId))) {
      setSelectedClusterId([...filteredClusters].sort((a, b) => compareClusters(a, b, sortBy))[0].cluster_id);
    }
  }, [allowedClusterIds, filteredClusters, selectedClusterId, sortBy]);

  const signalCards = useMemo(() => {
    if (!scopedData) return [];
    const selectedCategory = categoryFilter.trim().toLowerCase();
    const query = brandQuery.trim().toLowerCase();
    const keywordGroups = new Map<string, Keyword[]>();
    scopedData.keywords.forEach((item) => {
      const key = item.term_norm || item.term.toLocaleLowerCase();
      keywordGroups.set(key, [...(keywordGroups.get(key) || []), item]);
    });
    const keywordItems = [...keywordGroups.entries()].map(([norm, rows]) => {
      const mentions = rows.reduce((sum, row) => sum + Number(row.mentions || 0), 0);
      return {
        key: `keyword:${norm}`,
        kind: "keyword" as const,
        display: rows[0].term,
        mentions,
        sentiment: rows.reduce((sum, row) => sum + Number(row.sentiment || 0) * Math.max(Number(row.mentions || 0), 1), 0) / Math.max(mentions, 1),
        tag: rows[0].entity_type || "keyword",
        url: "",
        uniquePosts: rows.reduce((sum, row) => sum + Number(row.unique_posts || 0), 0),
        clusterCount: new Set(rows.map((row) => row.cluster_id)).size,
        clusterSignals: rows.map((row) => ({
          week_start: scopedData.meta.latest_week,
          cluster_id: row.cluster_id,
          cluster_name: row.cluster_name,
          brand_norm: norm,
          brand_display: row.term,
          brand_signal_type: row.entity_type || "keyword",
          unique_posts: Number(row.unique_posts || 0),
          mentions: Number(row.mentions || 0),
          avg_sentiment: row.sentiment
        })),
        aliases: [] as string[]
      };
    });
    const brandItems = scopedData.brands.map((item) => ({
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
        clusterSignals: scopedData.cluster_brand_signals.filter((signal) => signal.brand_norm === item.brand_norm)
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
    return [...filteredBrands, ...keywordItems.filter((item) => !selectedCategory || item.clusterSignals.some((signal) => signal.cluster_name.toLocaleLowerCase() === selectedCategory))]
      .sort((a, b) => b.mentions - a.mentions);
  }, [brandQuery, brandSort, brandTypeFilter, categoryFilter, scopedData, onlyBrand]);

  useEffect(() => {
    if (signalCards.length && !signalCards.some((item) => item.key === selectedSignalKey)) {
      setSelectedSignalKey(signalCards[0].key);
    }
  }, [selectedSignalKey, signalCards]);

  useEffect(() => {
    if (tab !== "evidence" || !evidenceTarget || !selectedWeek) return;
    if (!allowedClusterIds.has(String(evidenceTarget.clusterId))) {
      setEvidenceError(lang === "zh" ? "当前类目不在你的运营范围内。" : "This category is outside your operations scope.");
      setEvidencePosts([]);
      setTab("trend");
      return;
    }
    const controller = new AbortController();
    setEvidenceLoading(true);
    setEvidenceError("");
    setEvidencePosts([]);
    fetch(`/data/evidence/${selectedWeek}/${evidenceTarget.clusterId}.json`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Evidence request failed (${response.status})`);
        return response.json();
      })
      .then((payload: { brands?: Record<string, Post[]>; keywords?: Record<string, Post[]> }) => {
        const rows = evidenceTarget.kind === "brand"
          ? payload.brands?.[evidenceTarget.brandNorm] || []
          : payload.keywords?.[evidenceTarget.termNorm] || [];
        setEvidencePosts(rows);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setEvidenceError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setEvidenceLoading(false);
      });
    return () => controller.abort();
  }, [allowedClusterIds, evidenceTarget, lang, selectedWeek, tab]);

  if (!data || !opsMapping || !identityResolved) {
    return <main className="shell loading">{t("loading")}</main>;
  }
  if (view === "identity" || !identity) {
    return <IdentitySelection mapping={opsMapping} data={data} current={identity} invalidSavedIdentity={identityInvalid} onSelect={(next) => {
      window.localStorage.setItem(OPS_IDENTITY_STORAGE_KEY, JSON.stringify({
        identityKey: next.identityKey,
        opsTeam1: next.opsTeam1,
        opsTeam2: next.opsTeam2,
        mappingVersion: next.mappingVersion
      }));
      setIdentity(next);
      setIdentityInvalid(false);
      setSelectedClusterId("");
      setSelectedSignalKey("");
      setCategoryFilter("");
      setDashboardCategoryId("all");
      setSparkleCategoryId("all");
      setEvidenceTarget(null);
      setEvidencePosts([]);
      setTab("trend");
      setView("home");
    }} onClear={() => {
      window.localStorage.removeItem(OPS_IDENTITY_STORAGE_KEY);
      setIdentity(null);
    }} />;
  }
  if (!scopedData || !selectedCluster) {
    return <main className="shell loading emptyScope"><p>{t("noTeamSignals")}</p><button className="primaryLink" onClick={() => setView("identity")}>{t("switchIdentity")}</button></main>;
  }

  const applySortBy = (key: ScoreKey) => {
    setSortBy(key);
    const topCluster = [...filteredClusters].sort((a, b) => compareClusters(a, b, key))[0];
    if (topCluster) setSelectedClusterId(topCluster.cluster_id);
  };
  const openEvidence = (target: EvidenceTarget) => {
    setEvidenceTarget(target);
    setTab("evidence");
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
          <button className="identityChip" onClick={() => setView("identity")} title={t("switchIdentity")}>
            <small>{t("currentIdentity")}</small>
            <strong>{identity.identityKey === ALL_IDENTITY_KEY
              ? `${t("allTeams")} · ${t("allCategoriesIdentity")}`
              : `${identity.opsTeam1} · ${identity.opsTeam2}`}</strong>
          </button>
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

      {view === "home" && <Home data={scopedData} setView={setView} />}

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
              sortBy={sortBy}
              setSortBy={applySortBy}
              setSelectedClusterId={setSelectedClusterId}
              openEvidence={openEvidence}
            />
          )}

          {tab === "opportunity" && (
            <OpportunityTab
              clusters={filteredClusters}
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
              clusters={filteredClusters}
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
              sparkle={scopedData.sparkle}
              setSelectedClusterId={setSelectedClusterId}
              setSelectedSignalKey={setSelectedSignalKey}
              setOnlyBrand={setOnlyBrand}
              setTab={setTab}
            />
          )}

          {tab === "evidence" && (
            <EvidenceTab
              cluster={selectedCluster}
              target={evidenceTarget}
              posts={evidencePosts}
              loading={evidenceLoading}
              error={evidenceError}
              setTab={setTab}
            />
          )}
        </section>
      )}

      {view === "dashboard" && (
        <Dashboard
          data={scopedData}
          selectedCluster={selectedCluster}
          dashboardCategoryId={dashboardCategoryId}
          setDashboardCategoryId={setDashboardCategoryId}
          setSelectedClusterId={setSelectedClusterId}
        />
      )}
    </main>
  );
}

function IdentitySelection({ mapping, data, current, invalidSavedIdentity, onSelect, onClear }: {
  mapping: OpsMapping;
  data: DashboardBundle;
  current: OpsIdentity | null;
  invalidSavedIdentity: boolean;
  onSelect: (identity: OpsIdentity) => void;
  onClear: () => void;
}) {
  const { lang, setLang, t } = useLang();
  const [allSelected, setAllSelected] = useState(current?.identityKey === ALL_IDENTITY_KEY);
  const initialTeam = current?.identityKey === ALL_IDENTITY_KEY ? "" : current?.opsTeam1 || "";
  const [team1, setTeam1] = useState(initialTeam);
  const [team2, setTeam2] = useState(current?.identityKey === ALL_IDENTITY_KEY ? "" : current?.opsTeam2 || "");
  const team = mapping.ops_teams.find((item) => item.ops_team_1 === team1);
  const options = team?.ops_team_2_options || [];
  const option = options.find((item) => item.ops_team_2 === team2);
  const dashboardNames = useMemo(() => new Set(data.clusters.map((cluster) => normalizeCategoryName(cluster.cluster_name))), [data.clusters]);
  const matchedCategories = (option?.categories || []).filter((category) => dashboardNames.has(normalizeCategoryName(category)));

  const chooseTeam1 = (value: string) => {
    setAllSelected(false);
    setTeam1(value);
    const nextOptions = mapping.ops_teams.find((item) => item.ops_team_1 === value)?.ops_team_2_options || [];
    setTeam2(nextOptions.length === 1 ? nextOptions[0].ops_team_2 : "");
  };
  return (
    <main className="identityPage">
      <header className="identityTopbar">
        <strong><span>r/</span> Reddit Business Signal Radar</strong>
        <div className="langSwitch">
          {(["en", "zh"] as Lang[]).map((optionLang) => (
            <button key={optionLang} className={lang === optionLang ? "active" : ""} onClick={() => setLang(optionLang)}>
              {optionLang === "en" ? "EN" : "中文"}
            </button>
          ))}
        </div>
      </header>
      <section className="identityCard">
        <span className="eyebrow">Reddit Business Signal Radar</span>
        <h1>{t("identityTitle")}</h1>
        <p>{t("identityBody")}</p>
        {invalidSavedIdentity && <p className="mappingError">{t("invalidIdentity")}</p>}
        <button className={`allIdentityCard ${allSelected ? "active" : ""}`} onClick={() => {
          setAllSelected(true);
          setTeam1("");
          setTeam2("");
        }}>
          <strong>{t("allView")}</strong>
          <span>{t("allViewDescription")}</span>
        </button>
        <div className="identityDivider"><span>{t("orChooseIndustry")}</span></div>
        <div className="identityField">
          <label>{t("opsTeam1")}</label>
          <div className="teamCards">
            {mapping.ops_teams.map((item) => (
              <button key={item.ops_team_1} className={team1 === item.ops_team_1 ? "active" : ""} onClick={() => chooseTeam1(item.ops_team_1)}>
                {item.ops_team_1}
              </button>
            ))}
          </div>
        </div>
        <div className="identityField">
          <label>{t("opsTeam2")}</label>
          <select disabled={!team1} value={team2} onChange={(event) => { setAllSelected(false); setTeam2(event.target.value); }}>
            <option value="">{team1 ? t("chooseOpsTeam2") : t("chooseOpsTeam1First")}</option>
            {options.map((item) => <option key={item.identity_key} value={item.ops_team_2}>{item.ops_team_2}</option>)}
          </select>
        </div>
        {option && <p className={matchedCategories.length ? "categoryAvailability" : "mappingError"}>
          {matchedCategories.length ? `${t("youWillView")} ${matchedCategories.length} ${t("categoriesAvailable")}` : t("noMappedCategories")}
        </p>}
        {allSelected && <p className="categoryAvailability">{t("youWillViewAll")} {data.clusters.length} {t("validCategories")}</p>}
        <button className="identityCta" disabled={!allSelected && (!option || !matchedCategories.length)} onClick={() => {
          if (allSelected) {
            onSelect({ identityKey: ALL_IDENTITY_KEY, opsTeam1: "All Teams", opsTeam2: "All Categories", categoryNames: [], mappingVersion: mapping.version });
          } else if (option) {
            onSelect({ identityKey: option.identity_key, opsTeam1: team1, opsTeam2: team2, categoryNames: option.categories, mappingVersion: mapping.version });
          }
        }}>{t("enterSignalDashboard")}</button>
        {current && <button className="clearIdentity" onClick={onClear}>{t("clearIdentity")}</button>}
      </section>
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
        <Stat label={t("statWeeklyKeywordBrandSignals")} value={`${data.meta.weekly_keyword_signal_count.toLocaleString()} ${t("keywordsUnit")} · ${data.meta.weekly_brand_signal_count.toLocaleString()} ${t("brandsUnit")}`} compactValue />
        <Stat label={t("statCoveredClusters")} value={data.meta.covered_cluster_count.toLocaleString()} />
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
  sortBy,
  setSortBy,
  setSelectedClusterId,
  openEvidence
}: {
  clusters: Cluster[];
  selectedCluster: Cluster;
  sortBy: ScoreKey;
  setSortBy: (key: ScoreKey) => void;
  setSelectedClusterId: (id: string) => void;
  openEvidence: (target: EvidenceTarget) => void;
}) {
  const { lang, t } = useLang();
  const [brandLimit, setBrandLimit] = useState(20);
  useEffect(() => setBrandLimit(20), [selectedCluster.cluster_id]);
  const clusterBrands = [...selectedCluster.brands].sort(
    (a, b) => Number(b.unique_posts || 0) - Number(a.unique_posts || 0) || Number(b.mentions || 0) - Number(a.mentions || 0)
  );
  return (
    <div className="trendGrid">
      <article className="analysisViewPanel wide">
        <div className="panelHeader">
          <span>{t("analysisView")}</span>
          <h3>{dimensionLabel(lang, sortBy)}</h3>
        </div>
        <div className="dimensionFilters">
          {scoreOptions.map((option) => (
            <button key={option.key} aria-pressed={sortBy === option.key} className={sortBy === option.key ? "active" : ""} onClick={() => setSortBy(option.key)}>
              <strong>{dimensionLabel(lang, option.key)}</strong>
            </button>
          ))}
        </div>
        <p className="analysisViewHelper">{dimensionHelper(lang, sortBy)}</p>
        <small className="analysisViewHint">{t("analysisViewHint")}</small>
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
              <CategoryAvatar name={cluster.cluster_name} illustrationUrl={cluster.illustration_url} />
              <span>
                <strong>{cluster.cluster_name}</strong>
                <small>
                  {dimensionContext(cluster, sortBy, lang, t)}
                </small>
                <span className={`tag tag-${dimensionTag(cluster, sortBy, lang).tone}`}>{dimensionTag(cluster, sortBy, lang).label}</span>
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
          <div><span>{dimensionLabel(lang, "trend_score")}</span>{starRating(selectedCluster.trend_score)}</div>
          {(["momentum_score", "sentiment_score", "cross_community_score", "engagement_score"] as ScoreKey[]).map((key) => (
            <div key={key}><span>{dimensionLabel(lang, key)}</span><strong>{dimensionTag(selectedCluster, key, lang).label}</strong></div>
          ))}
        </div>
        <h4>{t("activeSources")}</h4>
        <div className="sourceGrid">
          {(selectedCluster.communities || []).map((source) => (
            <a key={source.subreddit} href={`https://www.reddit.com/r/${source.subreddit}`} target="_blank" rel="noreferrer">
              <b>r/{source.subreddit}</b>
              <small>{source.unique_posts} {t("postsUnit")} · {Math.round(source.discussion_share * 100)}% {t("categoryDiscussionShare")}</small>
            </a>
          ))}
          {!selectedCluster.communities?.length && <p className="emptyState">{t("noCommunityData")}</p>}
        </div>
        <h4>{t("topicLandscape")}</h4>
        <SignalWordCloud cluster={selectedCluster} openEvidence={openEvidence} />
        <h4>{t("relatedBrandsKeywords")}</h4>
        <div className="productCards">
          {[...clusterBrands.slice(0, brandLimit).map((item) => ({ type: "brand" as const, id: item.brand_norm, name: item.brand_display, signalType: item.brand_signal_type, tag: brandTypeLabel(item.brand_signal_type, lang), uniquePosts: item.unique_posts || 0, mentions: item.mentions || 0, url: item.google_search_url || googleBrandUrl(item.brand_display), logoUrl: item.logo_url || "" })), ...selectedCluster.terms.slice(0, 30).map((item) => ({ type: "keyword" as const, id: item.term_norm, name: item.term, signalType: "", tag: item.entity_type || "keyword", uniquePosts: item.unique_posts || 0, mentions: item.mentions || 0, url: "", logoUrl: "" }))].map((item) => (
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
                <button onClick={() => item.type === "brand"
                  ? openEvidence({ kind: "brand", clusterId: selectedCluster.cluster_id, brandNorm: item.id, display: item.name })
                  : openEvidence({ kind: "keyword", clusterId: selectedCluster.cluster_id, termNorm: item.id, display: item.name })}>{t("evidenceBtn")}</button>
              </span>
            </div>
          ))}
          {clusterBrands.length > brandLimit && <button className="loadMore" onClick={() => setBrandLimit((value) => value + 20)}>{t("loadMore")}</button>}
        </div>
      </article>
    </div>
  );
}

function SignalWordCloud({ cluster, openEvidence }: { cluster: Cluster; openEvidence: (target: EvidenceTarget) => void }) {
  const { lang, t } = useLang();
  const words = useMemo(() => {
    const brands = [...cluster.brands]
      .filter((item) => Number(item.unique_posts || 0) >= 2)
      .sort((a, b) => Number(b.unique_posts || 0) - Number(a.unique_posts || 0) || Number(b.mentions || 0) - Number(a.mentions || 0))
      .slice(0, 20)
      .map((item) => ({ kind: "brand" as const, id: item.brand_norm, display: item.brand_display, uniquePosts: Number(item.unique_posts || 0), mentions: Number(item.mentions || 0), sentiment: Number(item.sentiment || 0), type: brandTypeLabel(item.brand_signal_type, lang) }));
    const keywords = [...cluster.terms]
      .filter((item) => Number(item.unique_posts || 0) >= 2)
      .sort((a, b) => Number(b.unique_posts || 0) - Number(a.unique_posts || 0) || Number(b.mentions || 0) - Number(a.mentions || 0))
      .slice(0, 30)
      .map((item) => ({ kind: "keyword" as const, id: item.term_norm, display: item.term, uniquePosts: Number(item.unique_posts || 0), mentions: Number(item.mentions || 0), sentiment: Number(item.sentiment || 0), type: item.entity_type || "keyword" }));
    return [...brands, ...keywords].sort((a, b) => b.uniquePosts - a.uniquePosts || b.mentions - a.mentions || a.id.localeCompare(b.id));
  }, [cluster.brands, cluster.terms, lang]);
  const minFrequency = Math.min(...words.map((word) => word.uniquePosts), 1);
  const maxFrequency = Math.max(...words.map((word) => word.uniquePosts), 1);
  const sizeFor = (frequency: number) => {
    const range = Math.max(Math.sqrt(maxFrequency) - Math.sqrt(minFrequency), 1);
    return 16 + ((Math.sqrt(frequency) - Math.sqrt(minFrequency)) / range) * 22;
  };
  const colorFor = (sentiment: number) => sentiment >= 0.15 ? "#167458" : sentiment <= -0.08 ? "#b5483f" : "#48627a";
  return (
    <div className="signalWordCloud">
      {words.map((word) => (
        <button
          key={`${word.kind}:${word.id}`}
          style={{ fontSize: `${sizeFor(word.uniquePosts)}px`, color: colorFor(word.sentiment), fontWeight: word.kind === "brand" ? 800 : 550 }}
          title={`${word.display}\n${word.type}\n${word.uniquePosts} ${t("discussionPosts")}\n${word.mentions} ${t("mentionsUnit")}\n${sentimentTag(lang, sentimentClass(word.sentiment) as SentimentKey)}`}
          onClick={() => word.kind === "brand"
            ? openEvidence({ kind: "brand", clusterId: cluster.cluster_id, brandNorm: word.id, display: word.display })
            : openEvidence({ kind: "keyword", clusterId: cluster.cluster_id, termNorm: word.id, display: word.display })}
        >
          {word.display}
        </button>
      ))}
      {!words.length && <p className="emptyState">{t("noSignalData")}</p>}
    </div>
  );
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
  const hasPercentiles = (cluster: Cluster) => Number.isFinite(Number(cluster.momentum_percentile))
    && Number.isFinite(Number(cluster.cross_community_percentile));
  const momentumRank = (cluster: Cluster) => hasPercentiles(cluster) ? Number(cluster.momentum_percentile) : cluster.momentum_score / 5;
  const reachRank = (cluster: Cluster) => hasPercentiles(cluster) ? Number(cluster.cross_community_percentile) : cluster.cross_community_score / 5;
  const broad = [...clusters]
    .filter((cluster) => hasPercentiles(cluster)
      ? momentumRank(cluster) >= 0.7 && reachRank(cluster) >= 0.7
      : cluster.momentum_score >= 4 && cluster.cross_community_score >= 4)
    .sort((a, b) => b.trend_score - a.trend_score
      || momentumRank(b) - momentumRank(a)
      || reachRank(b) - reachRank(a)
      || b.current_week_posts - a.current_week_posts
      || a.cluster_name.localeCompare(b.cluster_name))
    .slice(0, 5);
  const niche = [...clusters]
    .filter((cluster) => hasPercentiles(cluster)
      ? momentumRank(cluster) >= 0.7 && reachRank(cluster) < 0.5
      : cluster.momentum_score >= 4 && cluster.cross_community_score < 3)
    .sort((a, b) => momentumRank(b) - momentumRank(a)
      || b.current_week_posts - a.current_week_posts
      || b.trend_score - a.trend_score
      || a.unique_subreddits - b.unique_subreddits
      || a.cluster_name.localeCompare(b.cluster_name))
    .slice(0, 5);
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
        {!rows.length && <p className="emptyState">{t("noOpportunityCategories")}</p>}
        {rows.map((cluster, index) => (
          <button key={cluster.cluster_id} className="opportunityRow" onClick={() => openClusterDetail(cluster.cluster_id)}>
            <b>#{index + 1}</b>
            <span>
              <strong>{cluster.cluster_name}</strong>
              <small>
                {cluster.current_week_posts} {t("postsUnit")} · {cluster.previous_week_posts === 0
                  ? t("newTag")
                  : `${cluster.growth_rate >= 0 ? "+" : ""}${Math.round(cluster.growth_rate * 100)}% WoW`} · {cluster.unique_subreddits} {t("subredditsUnit")}
              </small>
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
  sparkle,
  setSelectedClusterId,
  setSelectedSignalKey,
  setOnlyBrand,
  setTab
}: {
  sparkle: SparkleData;
  setSelectedClusterId: (id: string) => void;
  setSelectedSignalKey: (key: string) => void;
  setOnlyBrand: (value: boolean) => void;
  setTab: (tab: ExploreTab) => void;
}) {
  const { t } = useLang();
  const [visibleSignals, setVisibleSignals] = useState(40);
  useEffect(() => setVisibleSignals(40), [sparkle.current_week]);
  if (sparkle.status === "insufficient_comparison_weeks") {
    return <article className="panel"><p className="emptyState">{t("sparkleInsufficientWeeks")}</p></article>;
  }
  return (
    <div className="singleColumn sparklePage">
      <p className="sparkleDefinition">{t("sparkleDefinition")}</p>
      <div className="mappingGrid">
      <article className="panel">
        <div className="panelHeader">
          <span>{t("freshKicker")}</span>
          <h3>{t("newActiveCategories")}</h3>
          <p>{t("newActiveCategoriesHelp")}</p>
        </div>
        <div className="sparkleList"><div className="sparkleGroup">
            {!sparkle.newly_active_clusters.length && <p className="emptyState">{t("noNewSparkleItems")}</p>}
            {sparkle.newly_active_clusters.map((cluster) => (
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
        </div></div>
      </article>
      <article className="panel">
        <div className="panelHeader">
          <span>{t("freshKicker")}</span>
          <h3>{t("newlyDetectedSignals")}</h3>
          <p>{t("newlyDetectedSignalsHelp")}</p>
        </div>
        <div className="sparkleList"><div className="sparkleGroup">
            {!sparkle.new_signals.length && <p className="emptyState">{t("noNewSparkleItems")}</p>}
            {sparkle.new_signals.slice(0, visibleSignals).map((signal) => (
              <button
                key={`${signal.kind}:${signal.cluster_id}:${signal.signal_norm}`}
                onClick={() => {
                  setSelectedClusterId(signal.cluster_id);
                  setSelectedSignalKey(`${signal.kind}:${signal.signal_norm}`);
                  setOnlyBrand(signal.kind === "brand");
                  setTab("mapping");
                }}
              >
                {signal.kind === "brand"
                  ? <BrandAvatar name={signal.display} logoUrl={signal.logo_url} size="md" />
                  : <i className="keywordAvatar">#</i>}
                <span>
                  <strong>{signal.display}</strong>
                  <small>{signal.cluster_name} · {signal.unique_posts} {t("postsUnit")} · {signal.mentions} {t("mentionsUnit")}</small>
                  <span className="brandTypeBadge">{signal.ui_tag === "verified_brand" ? t("verifiedBrandTag") : t("brandKeywordTag")}</span>
                </span>
                <em>›</em>
              </button>
            ))}
            {sparkle.new_signals.length > visibleSignals && <button className="loadMore" onClick={() => setVisibleSignals((value) => value + 40)}>{t("loadMore")}</button>}
        </div></div>
      </article>
      </div>
    </div>
  );
}

function EvidenceTab({ cluster, target, posts, loading, error, setTab }: { cluster: Cluster; target: EvidenceTarget | null; posts: Post[]; loading: boolean; error: string; setTab: (tab: ExploreTab) => void }) {
  const { t } = useLang();
  return (
    <article className="panel">
      <div className="panelHeader splitHeader">
        <span>{t("evidenceKicker")}</span>
        <h3>{cluster.cluster_name}<br />{target ? `${target.display} · ${t("evidenceTitleSuffix")}` : t("evidenceTitleSuffix")}</h3>
        <button className="ghost" onClick={() => setTab("trend")}>
          {t("backToCategory")}
        </button>
      </div>
      <div className="evidenceGrid">
        {loading && <p className="emptyState">{t("evidenceLoading")}</p>}
        {error && <p className="emptyState">{error}</p>}
        {!loading && !error && !posts.length && <p className="emptyState">{t("noSignalEvidence")}</p>}
        {posts.map((post) => (
          <article key={post.post_key || post.url || post.title}>
            <div>
              <strong>{post.title}</strong>
              <span>r/{post.subreddit || t("fallbackUnknown")} · {post.published_at || ""}</span>
            </div>
            <p>{post.context_window || post.text_snippet}</p>
            <div>
              <span>
                {post.matched_display || target?.display || t("fallbackReddit")} · {post.sentiment_label || "neutral"}
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
