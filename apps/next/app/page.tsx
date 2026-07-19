"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Calendar,
  ChevronDown,
  Compass,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Home as HomeIcon,
  MessagesSquare,
  Search,
  Tag,
  TrendingDown,
  TrendingUp,
  Users
} from "lucide-react";
import { BrandAvatar } from "./components/BrandAvatar";
import { CategoryAvatar } from "./components/CategoryAvatar";
import { BrandSignalCloud } from "./components/BrandSignalCloud";
import { HorizontalScroller } from "./components/HorizontalScroller";
import { TikTokRadarChart, type RadarMetric, type RadarMetricKey } from "./components/TikTokRadarChart";
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
  brand_domain?: string;
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
  brand_domain?: string;
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

type BrandLogoBundle = {
  recognized_brand_count: number;
  logo_count: number;
  logos: Record<string, string>;
};

function applyBrandLogos(bundle: DashboardBundle, logoMap: Record<string, string>): DashboardBundle {
  const logoFor = (brandNorm: string) => logoMap[brandNorm] || "";
  return {
    ...bundle,
    brands: bundle.brands.map((brand) => ({
      ...brand,
      logo_url: logoFor(brand.brand_norm)
    })),
    clusters: bundle.clusters.map((cluster) => ({
      ...cluster,
      brands: cluster.brands.map((brand) => ({
        ...brand,
        logo_url: logoFor(brand.brand_norm)
      }))
    })),
    sparkle: {
      ...bundle.sparkle,
      new_signals: bundle.sparkle.new_signals.map((signal) => ({
        ...signal,
        logo_url: signal.kind === "brand"
          ? logoFor(signal.signal_norm)
          : ""
      }))
    }
  };
}

// -- Brand / keyword noise reduction --------------------------------------------------
// The pipeline already produces a real confidence signal (07_extract_entities.py: whitelist
// alias matches score 1.0, catalog n-gram matches 0.85, regex-candidate matches a flat 0.45)
// but nothing downstream of the pipeline ever gates on it -- Brands/Keywords today shows
// every brand_signal_type indiscriminately and every keyword above unique_posts >= 2 with
// no entity_type/length/stoplist check at all. This curates that down to a much smaller,
// higher-confidence set, applied once at load time so every consumer (per-cluster
// RelatedSignalsPanel, Tab 2's signalCards, Home's Top 15) sees the same curated data with
// no other code changes needed. cluster_brand_signals/sparkle/posts are left untouched --
// sparkle's own 3-week-new diffing and the dashboard-contract row-count tests depend on the
// raw (uncurated) versions of those.
function isHighConfidenceNonWhitelistBrand(brand: { brand_signal_type?: string; unique_posts?: number }) {
  return brand.brand_signal_type === "catalog_known_brand" && Number(brand.unique_posts || 0) >= 2;
}

const KEYWORD_QUALITY_ALLOWED_TYPES = new Set([
  "product_phrase", "category_keyword", "need_state", "ingredient_material", "retailer_channel"
]);
// Deliberately separate from build_web_dashboard_bundle.py's SPARKLE_KEYWORD_STOPLIST --
// Sparkle's own quality gate must not be touched by this round's changes.
const KEYWORD_NOISE_STOPLIST = new Set([
  "link comments", "read more", "see more", "click here", "view all", "this post", "this comment"
]);

function isHighQualityKeyword(term: { term_norm?: string; entity_type?: string; unique_posts?: number }) {
  const text = String(term.term_norm || "").trim();
  if (!KEYWORD_QUALITY_ALLOWED_TYPES.has(String(term.entity_type || ""))) return false;
  if (Number(term.unique_posts || 0) < 3) return false;
  if (text.length < 3) return false;
  if (/^\d+$/.test(text)) return false;
  if (/^[^\w\s]+$/.test(text)) return false;
  if (/^(u|r)\//.test(text)) return false;
  if (/http|www\.|\.com\b/.test(text)) return false;
  if (KEYWORD_NOISE_STOPLIST.has(text)) return false;
  return true;
}

function curateBrandsKeywords<B extends ClusterBrand | Brand, K extends ClusterTerm | Keyword>(
  brands: B[],
  terms: K[]
): { brands: B[]; terms: K[] } {
  const curatedBrands = brands.filter((brand) =>
    isVerifiedShoppingBrand(brand.brand_signal_type, brand.brand_domain)
    || isHighConfidenceNonWhitelistBrand(brand)
    || isPlatformServiceBrand(brand.brand_domain));
  const keptBrandNorms = new Set(curatedBrands.map((brand) => brand.brand_norm));
  const curatedTerms = terms.filter((term) =>
    isHighQualityKeyword(term) && !keptBrandNorms.has(String(term.term_norm || "")));
  return { brands: curatedBrands, terms: curatedTerms };
}

function sanitizeSignalNoise(bundle: DashboardBundle): DashboardBundle {
  const { brands: curatedTopBrands, terms: curatedTopKeywords } = curateBrandsKeywords(bundle.brands, bundle.keywords);
  return {
    ...bundle,
    brands: curatedTopBrands,
    keywords: curatedTopKeywords,
    clusters: bundle.clusters.map((cluster) => {
      const { brands, terms } = curateBrandsKeywords(cluster.brands, cluster.terms);
      return { ...cluster, brands, terms };
    })
  };
}

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

type View = "identity" | "home" | "explore";
// Signal Explorer collapsed from 4 tabs to 2: "category" merges the old trend-ranking +
// opportunity-quadrant pages, "signals" merges the old brand/keyword mapping + sparkle
// pages. "evidence" stays as an internal detail view, not a user-facing tab.
type ExploreTab = "category" | "signals" | "evidence";
type SignalScope = "verified_brands" | "brands_and_keywords";
type SignalSort = "volume" | "mentions" | "positive";
type RankView = "top10" | "worth_watching" | "all";

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
  if (sortBy === "cross_community_score") return `${cluster.unique_subreddits} ${t("communitiesUnit")} · ${cluster.current_week_posts} ${t("postsUnit")}`;
  if (sortBy === "sentiment_score") return `${Math.round(finite(cluster.positive_share) * 100)}% ${t("positiveUnit")} · ${cluster.current_week_posts} ${t("postsUnit")}`;
  if (sortBy === "engagement_score") return `${cluster.current_week_posts} ${t("postsUnit")} · ${fmt(cluster.avg_log_engagement, 2)} ${t("engagementUnit")}`;
  return `${cluster.current_week_posts} ${t("postsUnit")} · ${cluster.unique_subreddits} ${t("communitiesUnit")}`;
}

// Builds the 5-axis radar input from the cluster's existing scores -- no new metrics,
// no recomputation. Business tag/helper text reuse the same dimensionTag()/
// dimensionHelper() the rest of the product already shows, so the radar's read of a
// dimension always matches the ranking lists and dashboard.
function radarMetricsForCluster(cluster: Cluster, lang: Lang, t: (key: TKey) => string): RadarMetric[] {
  return scoreOptions.map((option) => ({
    key: option.key as RadarMetricKey,
    value: finite(cluster[option.key]),
    label: dimensionLabel(lang, option.key),
    businessTag: dimensionTag(cluster, option.key, lang).label,
    helper: dimensionHelper(lang, option.key)
  }));
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

function brandTag(type?: string) {
  return type ? type.replaceAll("_", " ") : "other";
}

// A whitelisted or catalog-known brand that isn't a shopping brand (PayPal, TikTok,
// Google...) should never read as "Verified"/"Known" in the Brands/Keywords list --
// that badge is reserved for shopping brands. Domain wins over signal-type here.
function brandTypeLabel(type: string | undefined, lang: Lang, domain?: string) {
  if (isPlatformServiceBrand(domain)) return lang === "zh" ? "平台 / 服务" : "Platform / Service";
  if (type === "confirmed_whitelist_brand") return lang === "zh" ? "白名单品牌" : "Verified Brand";
  if (type === "catalog_known_brand") return lang === "zh" ? "已知品牌" : "Known Brand";
  return lang === "zh" ? "候选品牌" : "Emerging Candidate";
}

// Math.max(...array) blows the call stack once array length crosses the engine's
// argument-count limit (easily hit by signalCards, which can run into the thousands
// for the unfiltered Brands/Keywords scope). A plain reduce has no such ceiling.
function maxOf(values: number[], fallback: number) {
  let result = fallback;
  for (const value of values) {
    if (value > result) result = value;
  }
  return result;
}

function brandTypeClass(type?: string) {
  if (type === "confirmed_whitelist_brand") return "verified";
  if (type === "catalog_known_brand") return "known";
  return "candidate";
}

// "Verified Brands" means shopping brands, not "any whitelisted name" -- a whitelisted
// payment/search/social/marketplace/service brand (PayPal, TikTok, Google, Amazon...)
// still routes into Brands/Keywords. brand_domain defaults to "shopping" server-side for
// anything not on the curated denylist, so a missing field also reads as shopping.
function isVerifiedShoppingBrand(signalType?: string, brandDomain?: string) {
  return signalType === "confirmed_whitelist_brand" && (brandDomain || "shopping") === "shopping";
}

function isPlatformServiceBrand(brandDomain?: string) {
  return Boolean(brandDomain) && brandDomain !== "shopping";
}

// Classic red-yellow-green traffic-light scale: an explicit yellow stop at 0 reads more
// clearly as "neutral" than a gray midpoint, and avoids the muddy olive that a direct
// red->green RGB interpolation produces.
const SENTIMENT_GRADIENT_STOPS: Array<{ at: number; color: [number, number, number] }> = [
  { at: -1, color: [214, 69, 69] }, // negative #D64545
  { at: 0, color: [237, 197, 62] }, // neutral yellow #EDC53E
  { at: 1, color: [79, 138, 110] } // positive #4F8A6E
];

// Continuous negative->positive sentiment color instead of a 3-bucket red/gray/green
// classification -- a -0.05 and a -0.4 post shouldn't render identically. Score is
// clamped to [-1, 1] and linearly interpolated between the nearest two stops above.
function sentimentGradientColor(score: number): string {
  const clamped = Math.max(-1, Math.min(1, Number(score) || 0));
  for (let i = 0; i < SENTIMENT_GRADIENT_STOPS.length - 1; i += 1) {
    const start = SENTIMENT_GRADIENT_STOPS[i];
    const end = SENTIMENT_GRADIENT_STOPS[i + 1];
    if (clamped >= start.at && clamped <= end.at) {
      const t = (clamped - start.at) / (end.at - start.at);
      const [r1, g1, b1] = start.color;
      const [r2, g2, b2] = end.color;
      const r = Math.round(r1 + (r2 - r1) * t);
      const g = Math.round(g1 + (g2 - g1) * t);
      const b = Math.round(b1 + (b2 - b1) * t);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return `rgb(${SENTIMENT_GRADIENT_STOPS[SENTIMENT_GRADIENT_STOPS.length - 1].color.join(", ")})`;
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

function bingSearchUrl(query: string) {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
}

// "Brand Profile" / "Explore Topic" always open something -- the user never needs to know
// or choose which site. Wikipedia is checked live via its public REST API (CORS-enabled by
// design, no key needed); if a page exists, that's what opens. Otherwise brands fall back to
// Google, keywords to Bing (spec: keywords shouldn't hard-depend on Google). The tab opens
// synchronously on click (before the `await`) so the browser's popup blocker sees it as a
// direct response to the user gesture; the async lookup then redirects that already-open tab.
async function openProfileLink(name: string, fallbackUrl: string) {
  const tab = window.open("", "_blank", "noopener,noreferrer");
  try {
    const title = encodeURIComponent(name.trim().replace(/\s+/g, "_"));
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}?redirect=true`, { mode: "cors" });
    if (response.ok) {
      const data = await response.json();
      const wikiUrl = data?.content_urls?.desktop?.page;
      if (wikiUrl) {
        if (tab) tab.location.href = wikiUrl;
        else window.open(wikiUrl, "_blank", "noopener,noreferrer");
        return;
      }
    }
  } catch {
    // Network error or no matching Wikipedia page -- fall through to the fallback below.
  }
  if (tab) tab.location.href = fallbackUrl;
  else window.open(fallbackUrl, "_blank", "noopener,noreferrer");
}

function openBrandProfile(name: string) {
  void openProfileLink(name, bingSearchUrl(`${name} brand`));
}

function openExploreTopic(name: string) {
  void openProfileLink(name, bingSearchUrl(name));
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
  const [tab, setTab] = useState<ExploreTab>("category");
  const [sortBy, setSortBy] = useState<ScoreKey>("trend_score");
  const [rankView, setRankView] = useState<RankView>("top10");
  const [selectedClusterId, setSelectedClusterId] = useState<string>("");
  const [signalScope, setSignalScope] = useState<SignalScope>("verified_brands");
  const [signalCategoryId, setSignalCategoryId] = useState("all");
  const [brandQuery, setBrandQuery] = useState("");
  const [selectedSignalKey, setSelectedSignalKey] = useState("");
  const [opportunityZoom, setOpportunityZoom] = useState(1);
  const [opportunityDrag, setOpportunityDrag] = useState(0);
  const [selectedWeek, setSelectedWeek] = useState("");
  const [signalSort, setSignalSort] = useState<SignalSort>("volume");
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
        const keywordPromise = wireBundle.keywords
          ? Promise.resolve(wireBundle.keywords)
          : wireBundle.keywords_url
            ? fetch(wireBundle.keywords_url, { cache: "no-store" }).then(async (response) => {
              if (!response.ok) throw new Error(`Keywords request failed (${response.status})`);
              const keywordBundle = (await response.json()) as KeywordBundle;
              if (keywordBundle.week_start !== wireBundle.meta.latest_week) {
                throw new Error("Dashboard and keyword bundles are for different weeks");
              }
              return keywordBundle.keywords;
            })
            : Promise.reject(new Error("Dashboard bundle is missing keywords_url"));
        const logoPromise = fetch("/data/brand-logos.json", { cache: "force-cache" })
          .then(async (response) => {
            if (!response.ok) throw new Error(`Whitelist logo request failed (${response.status})`);
            return (await response.json()) as BrandLogoBundle;
          })
          .catch((error: unknown) => {
            console.error(error);
            return { recognized_brand_count: 0, logo_count: 0, logos: {} };
          });
        const [keywords, logoBundle] = await Promise.all([keywordPromise, logoPromise]);
        return sanitizeSignalNoise(applyBrandLogos(
          { ...wireBundle, keywords } as DashboardBundle,
          logoBundle.logos
        ));
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
        brandDomain: item.brand_domain,
        url: item.google_search_url || googleBrandUrl(item.brand_display),
        logoUrl: item.logo_url || "",
        aliases: item.aliases || [],
        clusterSignals: scopedData.cluster_brand_signals.filter((signal) => signal.brand_norm === item.brand_norm)
      }));
    const searchMatch = (item: { display: string; key: string; aliases: string[] }) => !query
      || [item.display, item.key.slice(item.key.indexOf(":") + 1), ...item.aliases].some((value) => value.toLowerCase().includes(query));
    const categoryMatch = (item: { clusterSignals: ClusterBrandSignal[] }) => signalCategoryId === "all"
      || item.clusterSignals.some((signal) => String(signal.cluster_id) === signalCategoryId);
    const bySort = (a: { uniquePosts: number; mentions: number; sentiment: number }, b: { uniquePosts: number; mentions: number; sentiment: number }) => {
      if (signalSort === "mentions") return b.mentions - a.mentions;
      if (signalSort === "positive") return b.sentiment - a.sentiment;
      return b.uniquePosts - a.uniquePosts;
    };
    // Verified Brands and Brands/Keywords are disjoint sets -- a confirmed_whitelist_brand
    // shows up in exactly one of the two scopes, never both, matching the same split used in
    // the per-category Related Signals panel (RelatedSignalsPanel / toSignalRow).
    const filteredBrands = brandItems
      .filter((item) => signalScope === "verified_brands"
        ? isVerifiedShoppingBrand(item.tag, item.brandDomain)
        : !isVerifiedShoppingBrand(item.tag, item.brandDomain))
      .filter(searchMatch)
      .filter(categoryMatch)
      .sort(bySort);
    if (signalScope === "verified_brands") return filteredBrands;
    return [...filteredBrands, ...keywordItems.filter(searchMatch).filter(categoryMatch)].sort(bySort);
  }, [brandQuery, signalScope, signalSort, signalCategoryId, scopedData]);

  // Selecting a signal is an explicit user action -- no auto-selected first item. If the
  // current selection falls out of the (now filtered/re-scoped) result set, clear it
  // rather than snapping to whatever is first.
  useEffect(() => {
    if (selectedSignalKey && !signalCards.some((item) => item.key === selectedSignalKey)) {
      setSelectedSignalKey("");
    }
  }, [selectedSignalKey, signalCards]);

  useEffect(() => {
    if (tab !== "evidence" || !evidenceTarget || !selectedWeek) return;
    if (!allowedClusterIds.has(String(evidenceTarget.clusterId))) {
      setEvidenceError(lang === "zh" ? "当前类目不在你的运营范围内。" : "This category is outside your operations scope.");
      setEvidencePosts([]);
      setTab("category");
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
      setEvidenceTarget(null);
      setEvidencePosts([]);
      setTab("category");
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
    setTab("category");
  };
  const goToCategoryTab = () => {
    setTab("category");
    setView("explore");
  };
  const goToSignalsTab = () => {
    setTab("signals");
    setView("explore");
  };
  const openClusterFromHome = (clusterId: string) => {
    openClusterDetail(clusterId);
    setView("explore");
  };
  const openBrandFromHome = (brandNorm: string) => {
    setSignalScope("verified_brands");
    setSignalCategoryId("all");
    setSelectedSignalKey(`brand:${brandNorm}`);
    goToSignalsTab();
  };

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("home")}>
          <span>r/</span>
          {t("brandName")}
        </button>
        <nav>
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>
            {t("navHome")}
          </button>
          <button className={view === "explore" && tab === "category" ? "active" : ""} onClick={goToCategoryTab}>
            {t("navCategorySignals")}
          </button>
          <button className={view === "explore" && tab === "signals" ? "active" : ""} onClick={goToSignalsTab}>
            {t("navBrandDiscovery")}
          </button>
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
            <Download size={14} /> {t("exportBtn")}
          </button>
        </div>
      </header>

      {view === "home" && (
        <Home
          data={scopedData}
          onOpenCategoryTab={goToCategoryTab}
          onOpenBrandTab={goToSignalsTab}
          onOpenCluster={openClusterFromHome}
          onOpenBrand={openBrandFromHome}
        />
      )}

      {view === "explore" && (
        <section>
          {tab === "category" && (
            <CategoryTab
              clusters={clusters}
              allClusters={filteredClusters}
              selectedCluster={selectedCluster}
              sortBy={sortBy}
              setSortBy={applySortBy}
              rankView={rankView}
              setRankView={setRankView}
              setSelectedClusterId={setSelectedClusterId}
              openEvidence={openEvidence}
              zoom={opportunityZoom}
              drag={opportunityDrag}
              setZoom={setOpportunityZoom}
              setDrag={setOpportunityDrag}
              openClusterDetail={openClusterDetail}
            />
          )}

          {tab === "signals" && (
            <SignalsTab
              clusters={filteredClusters}
              signalCards={signalCards}
              selectedSignalKey={selectedSignalKey}
              signalScope={signalScope}
              brandQuery={brandQuery}
              signalSort={signalSort}
              signalCategoryId={signalCategoryId}
              setSignalScope={setSignalScope}
              setBrandQuery={setBrandQuery}
              setSignalSort={setSignalSort}
              setSignalCategoryId={setSignalCategoryId}
              setSelectedSignalKey={setSelectedSignalKey}
              sparkle={scopedData.sparkle}
              setSelectedClusterId={setSelectedClusterId}
              setTab={setTab}
              openEvidence={openEvidence}
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

// Home's own priority order for "worth watching" clusters -- deliberately separate from
// Tab 1's user-configurable sortBy/compareClusters (which the user can point at any of the
// 5 score dimensions). Home always leads with overall trend_score, using momentum and raw
// volume only as tie-breakers, since this is a fixed summary, not a re-orderable ranking.
function compareHomeClusters(a: Cluster, b: Cluster): number {
  return (b.trend_score - a.trend_score)
    || (finite(b.momentum_percentile) - finite(a.momentum_percentile))
    || (b.current_week_posts - a.current_week_posts);
}

function Home({ data, onOpenCategoryTab, onOpenBrandTab, onOpenCluster, onOpenBrand }: {
  data: DashboardBundle;
  onOpenCategoryTab: () => void;
  onOpenBrandTab: () => void;
  onOpenCluster: (clusterId: string) => void;
  onOpenBrand: (brandNorm: string) => void;
}) {
  const { lang, t } = useLang();
  const topCluster = [...data.clusters].sort(compareHomeClusters)[0];
  const topClusters = [...data.clusters].sort(compareHomeClusters).slice(0, 5);
  const topBrands = data.brands
    .filter((brand) => isVerifiedShoppingBrand(brand.brand_signal_type, brand.brand_domain))
    .sort((a, b) => b.unique_posts - a.unique_posts || b.mentions - a.mentions || a.brand_display.localeCompare(b.brand_display))
    .slice(0, 15);
  const capabilities = [
    { Icon: Compass, text: t("capability1") },
    { Icon: Users, text: t("capability2") },
    { Icon: MessagesSquare, text: t("capability3") }
  ];
  return (
    <section className="hero">
      <div className="eyebrow">{t("heroEyebrow")}</div>
      <h1>{t("heroTitle")}</h1>
      <p>{t("heroBody")}</p>
      <div className="capabilityRow">
        {capabilities.map(({ Icon, text }) => (
          <div key={text} className="capabilityItem">
            <Icon size={18} />
            <span>{text}</span>
          </div>
        ))}
      </div>
      <div className="stats">
        <Stat icon={Calendar} label={t("statAnalysisWeek")} value={formatWeekRange(data.meta.latest_week)} compactValue />
        <Stat icon={MessagesSquare} label={t("statWeeklyDiscussionPosts")} value={data.meta.weekly_post_count.toLocaleString()} />
        <Stat icon={Tag} label={t("statWeeklyKeywordBrandSignals")} value={`${data.meta.weekly_keyword_signal_count.toLocaleString()} ${t("keywordsUnit")} · ${data.meta.weekly_brand_signal_count.toLocaleString()} ${t("brandsUnit")}`} compactValue />
        <Stat icon={Gauge} label={t("statCoveredClusters")} value={data.meta.covered_cluster_count.toLocaleString()} />
      </div>
      <div className="routeCards">
        <button onClick={onOpenCategoryTab}>
          <span>{t("homeCardCategoryKicker")}</span>
          <strong>{t("homeCardCategoryTitle")}</strong>
          <small>{t("homeCardCategoryBody")}</small>
        </button>
        <button onClick={onOpenBrandTab}>
          <span>{t("homeCardBrandKicker")}</span>
          <strong>{t("homeCardBrandTitle")}</strong>
          <small>{t("homeCardBrandBody")}</small>
        </button>
      </div>
      {topCluster && (
        <article className="panel topClusterPanel">
          <div className="panelHeader">
            <span>{t("topClusterKicker")}</span>
            <h3>{topCluster.cluster_name}</h3>
          </div>
          <div className="radarDetailRow">
            <TikTokRadarChart
              metrics={radarMetricsForCluster(topCluster, lang, t)}
              centerValue={fmt(topCluster.trend_score_100 ?? topCluster.trend_score * 20, 0)}
              centerLabel={dimensionLabel(lang, "trend_score")}
            />
            <div className="radarSideStats">
              <Stat label={t("statWeeklyDiscussionPosts")} value={topCluster.current_week_posts.toLocaleString()} />
              <Stat label={t("communitiesUnit")} value={topCluster.unique_subreddits.toLocaleString()} />
              <Stat label={t("positiveUnit")} value={`${Math.round(finite(topCluster.positive_share) * 100)}%`} />
              <Stat label={t("statTag")} value={dimensionTag(topCluster, "trend_score", lang).label} />
            </div>
          </div>
        </article>
      )}

      <SectionHeader kicker={t("worthWatchingKicker")} title={t("worthWatchingTitle")} body="" />
      <div className="worthWatchingGrid">
        <article className="panel">
          <div className="panelHeader"><h3>{t("topClustersTitle")}</h3></div>
          {!topClusters.length && <p className="emptyState">{t("noTopClustersHomeMsg")}</p>}
          <div className="clusterList">
            {topClusters.map((cluster, index) => (
              <button key={cluster.cluster_id} onClick={() => onOpenCluster(cluster.cluster_id)}>
                <b>#{index + 1}</b>
                <CategoryAvatar name={cluster.cluster_name} illustrationUrl={cluster.illustration_url} size="sm" />
                <span>
                  <strong>{cluster.cluster_name}</strong>
                  <small>{dimensionContext(cluster, "trend_score", lang, t)}</small>
                  <small>{cluster.current_week_posts.toLocaleString()} {t("postsUnit")}</small>
                </span>
              </button>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panelHeader"><h3>{t("topBrandsTitle")}</h3></div>
          {!topBrands.length
            ? <p className="emptyState">{t("noBrandSignalsHomeMsg")}</p>
            : <BrandSignalCloud brands={topBrands} onSelect={onOpenBrand} />}
        </article>
      </div>
    </section>
  );
}

function Stat({ label, value, compactValue = false, icon: Icon }: { label: string; value: string; compactValue?: boolean; icon?: typeof Gauge }) {
  return (
    <div>
      <strong className={compactValue ? "compactValue" : ""}>{value}</strong>
      <span>{Icon && <Icon size={12} />} {label}</span>
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

function CategoryTab({
  clusters,
  allClusters,
  selectedCluster,
  sortBy,
  setSortBy,
  rankView,
  setRankView,
  setSelectedClusterId,
  openEvidence,
  zoom,
  drag,
  setZoom,
  setDrag,
  openClusterDetail
}: {
  clusters: Cluster[];
  allClusters: Cluster[];
  selectedCluster: Cluster;
  sortBy: ScoreKey;
  setSortBy: (key: ScoreKey) => void;
  rankView: RankView;
  setRankView: (value: RankView) => void;
  setSelectedClusterId: (id: string) => void;
  openEvidence: (target: EvidenceTarget) => void;
  zoom: number;
  drag: number;
  setZoom: (value: number) => void;
  setDrag: (value: number) => void;
  openClusterDetail: (id: string) => void;
}) {
  const { lang, t } = useLang();
  const rankIndex = clusters.findIndex((cluster) => cluster.cluster_id === selectedCluster.cluster_id);
  const radarMetrics = radarMetricsForCluster(selectedCluster, lang, t);
  const upperRef = useRef<HTMLDivElement | null>(null);
  const visibleClusters = rankView === "all"
    ? clusters
    : rankView === "worth_watching"
      ? clusters.filter((cluster) => {
        const tone = dimensionTag(cluster, sortBy, lang).tone;
        return tone !== "risk" && tone !== "steady";
      })
      : clusters.slice(0, 10);
  return (
    <div className="categoryTabPage">
      <div className="trendGrid" ref={upperRef}>
        <article className="analysisViewPanel wide">
          <div className="panelHeader">
            <span>{t("analysisView")}</span>
            <h3>{t("currentRanking")}</h3>
          </div>
          <div className="sortRow">
            <label className="sortSelectLabel">
              {t("sortByLabel")}
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as ScoreKey)}>
                {scoreOptions.map((option) => (
                  <option key={option.key} value={option.key}>{dimensionLabel(lang, option.key)}</option>
                ))}
              </select>
            </label>
            <span className="rankedByNote">{t("rankedByPrefix")} {dimensionLabel(lang, sortBy)}{t("rankedBySuffix")}</span>
          </div>
          <p className="analysisViewHelper">{dimensionHelper(lang, sortBy)}</p>
        </article>
        <article className="panel scrollPanel">
          <div className="panelHeader">
            <span>{t("rankKicker")}</span>
            <h3>{t("rankTitle")}</h3>
          </div>
          <div className="rankViewToggle" role="tablist">
            {(["top10", "worth_watching", "all"] as RankView[]).map((view) => (
              <button key={view} role="tab" aria-selected={rankView === view} className={rankView === view ? "active" : ""} onClick={() => setRankView(view)}>
                {view === "top10" ? t("viewTop10") : view === "worth_watching" ? t("viewWorthWatching") : t("viewAll")}
              </button>
            ))}
          </div>
          <p className="rankCountNote">{t("showingLabel")} {visibleClusters.length} / {clusters.length} {t("categoriesUnit")}</p>
          <div className="clusterList">
            {visibleClusters.map((cluster, index) => (
              <button
                key={cluster.cluster_id}
                data-active={selectedCluster.cluster_id === cluster.cluster_id || undefined}
                className={selectedCluster.cluster_id === cluster.cluster_id ? "active" : ""}
                onClick={(event) => {
                  setSelectedClusterId(cluster.cluster_id);
                  (event.currentTarget as HTMLElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
                }}
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
        <article className="panel stickyPanel">
          <div className="panelHeader">
            <span>{t("detailKicker")}</span>
            <h3 className="detailTitleWithAvatar">
              <CategoryAvatar name={selectedCluster.cluster_name} illustrationUrl={selectedCluster.illustration_url} size="md" />
              {selectedCluster.cluster_name}
            </h3>
          </div>
          <div className="radarDetailRow">
            <TikTokRadarChart
              metrics={radarMetrics}
              centerValue={fmt(selectedCluster.trend_score_100 ?? selectedCluster.trend_score * 20, 0)}
              centerLabel={dimensionLabel(lang, "trend_score")}
            />
            <div className="radarSideStats">
              {rankIndex >= 0 && <Stat label={t("rankKicker")} value={`#${rankIndex + 1}`} />}
              <Stat label={t("statWeeklyDiscussionPosts")} value={selectedCluster.current_week_posts.toLocaleString()} />
              <Stat label={t("communitiesUnit")} value={selectedCluster.unique_subreddits.toLocaleString()} />
              <Stat label={t("positiveUnit")} value={`${Math.round(finite(selectedCluster.positive_share) * 100)}%`} />
            </div>
          </div>
          <h4>{t("activeSources")}</h4>
          <HorizontalScroller ariaLabel={t("activeCommunitiesRegion")} className="communityRailScroller">
            <div className="communityRail">
              {(selectedCluster.communities || []).map((source) => (
                <a key={source.subreddit} className="communityCard" href={`https://www.reddit.com/r/${source.subreddit}`} target="_blank" rel="noreferrer">
                  <b>r/{source.subreddit}</b>
                  <small>{source.unique_posts} {t("postsUnit")} · {Math.round(source.discussion_share * 100)}% {t("categoryDiscussionShare")}</small>
                </a>
              ))}
              {!selectedCluster.communities?.length && <p className="emptyState">{t("noCommunityData")}</p>}
            </div>
          </HorizontalScroller>
          <RelatedSignalsPanel cluster={selectedCluster} openEvidence={openEvidence} />
        </article>
      </div>

      <OpportunitySection
        clusters={allClusters}
        selectedClusterId={selectedCluster.cluster_id}
        zoom={zoom}
        drag={drag}
        setZoom={setZoom}
        setDrag={setDrag}
        openClusterDetail={(id) => {
          openClusterDetail(id);
          upperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
    </div>
  );
}

type NormalizedSignalRow = {
  kind: "brand" | "keyword";
  id: string;
  name: string;
  uniquePosts: number;
  mentions: number;
  sentiment: number;
  signalType?: string;
  brandDomain?: string;
  entityType?: string;
  logoUrl?: string;
};

// Verified-brand membership requires BOTH confirmed_whitelist_brand AND brand_domain ===
// "shopping" -- a whitelisted payment/search/social/marketplace/service name (PayPal,
// TikTok, Google, Amazon...) still routes into Brands/Keywords, never Verified Brands. The
// exact same rule (isVerifiedShoppingBrand) is reused by Tab 2's global signal scope so the
// two surfaces never disagree about what counts as "verified".
function toSignalRow(item: ClusterBrand | ClusterTerm, kind: "brand" | "keyword"): NormalizedSignalRow {
  if (kind === "brand") {
    const brand = item as ClusterBrand;
    return {
      kind, id: brand.brand_norm, name: brand.brand_display,
      uniquePosts: Number(brand.unique_posts || 0), mentions: Number(brand.mentions || 0), sentiment: Number(brand.sentiment || 0),
      signalType: brand.brand_signal_type, brandDomain: brand.brand_domain, logoUrl: brand.logo_url || ""
    };
  }
  const term = item as ClusterTerm;
  return {
    kind, id: term.term_norm, name: term.term,
    uniquePosts: Number(term.unique_posts || 0), mentions: Number(term.mentions || 0), sentiment: Number(term.sentiment || 0),
    entityType: term.entity_type
  };
}

function sortSignalRows(rows: NormalizedSignalRow[], sortMode: "volume" | "mentions") {
  return [...rows].sort((a, b) => sortMode === "mentions"
    ? b.mentions - a.mentions || b.uniquePosts - a.uniquePosts || a.name.localeCompare(b.name)
    : b.uniquePosts - a.uniquePosts || b.mentions - a.mentions || a.name.localeCompare(b.name));
}

function RelatedSignalsPanel({ cluster, openEvidence }: { cluster: Cluster; openEvidence: (target: EvidenceTarget) => void }) {
  const { lang, t } = useLang();
  const [activeTab, setActiveTab] = useState<"verified_brands" | "brands_keywords">("verified_brands");
  const [visibleCount, setVisibleCount] = useState(20);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"volume" | "mentions">("volume");
  // Switching category always lands back on Verified Brands -- even when that category has
  // none (an explicit "no verified brands here" empty state beats silently landing on the
  // other tab, which would read as "the filter is broken" rather than "this category has none").
  useEffect(() => {
    setActiveTab("verified_brands");
    setQuery("");
    setSortMode("volume");
  }, [cluster.cluster_id]);
  useEffect(() => setVisibleCount(20), [activeTab, query, sortMode]);

  const verifiedBrands = useMemo(() => sortSignalRows(
    cluster.brands.filter((item) => isVerifiedShoppingBrand(item.brand_signal_type, item.brand_domain)).map((item) => toSignalRow(item, "brand")),
    sortMode
  ), [cluster.brands, sortMode]);
  const brandsKeywords = useMemo(() => sortSignalRows([
    ...cluster.brands.filter((item) => !isVerifiedShoppingBrand(item.brand_signal_type, item.brand_domain)).map((item) => toSignalRow(item, "brand")),
    ...cluster.terms.map((item) => toSignalRow(item, "keyword"))
  ], sortMode), [cluster.brands, cluster.terms, sortMode]);

  const activeRows = activeTab === "verified_brands" ? verifiedBrands : brandsKeywords;
  const queryLower = query.trim().toLowerCase();
  const filteredRows = queryLower ? activeRows.filter((row) => row.name.toLowerCase().includes(queryLower)) : activeRows;

  return (
    <div className="relatedSignals">
      <div className="relatedSignalsTabs" role="tablist" aria-label={t("relatedBrandsKeywords")}>
        <button role="tab" aria-selected={activeTab === "verified_brands"} className={activeTab === "verified_brands" ? "active" : ""} onClick={() => setActiveTab("verified_brands")}>
          {t("verifiedBrandsTabLabel")} <em>{verifiedBrands.length}</em>
        </button>
        <button role="tab" aria-selected={activeTab === "brands_keywords"} className={activeTab === "brands_keywords" ? "active" : ""} onClick={() => setActiveTab("brands_keywords")}>
          {t("brandsKeywordsTabLabel")} <em>{brandsKeywords.length}</em>
        </button>
      </div>
      <div className="relatedSignalsFilters">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={activeTab === "verified_brands" ? t("searchVerifiedBrandsPlaceholder") : t("searchBrandsKeywordsPlaceholder")}
        />
        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as "volume" | "mentions")}>
          <option value="volume">{t("sortVolume")}</option>
          <option value="mentions">{t("sortMentions")}</option>
        </select>
      </div>
      <div className="signalRows">
        {!filteredRows.length && <p className="emptyState">{activeTab === "verified_brands" ? t("noVerifiedBrandsMsg") : t("noBrandsKeywordsMsg")}</p>}
        {filteredRows.slice(0, visibleCount).map((item) => {
          const isBrand = item.kind === "brand";
          const tagLabel = isBrand ? brandTypeLabel(item.signalType, lang, item.brandDomain) : (item.entityType || "keyword");
          const tagClass = isBrand ? brandTypeClass(item.signalType) : "known";
          const openThisEvidence = () => openEvidence(isBrand
            ? { kind: "brand", clusterId: cluster.cluster_id, brandNorm: item.id, display: item.name }
            : { kind: "keyword", clusterId: cluster.cluster_id, termNorm: item.id, display: item.name });
          return (
            <div key={`${item.kind}:${item.id}`} className="signalRow">
              {isBrand
                ? <BrandAvatar name={item.name} logoUrl={item.logoUrl || ""} signalType={item.signalType} size="md" />
                : <BrandAvatar name={item.name} size="md" />}
              <span className="signalRowText">
                <b>{item.name}</b>
                <small>
                  <span className={`brandTypeBadge ${tagClass}`}>{tagLabel}</span> · {item.uniquePosts} {t("postsUnit")} · {item.mentions} {t("mentionsUnit")} · {sentimentTag(lang, sentimentClass(item.sentiment) as SentimentKey)}
                </small>
              </span>
              <div className="signalRowActions">
                <button
                  className="signalRowAction"
                  title={isBrand ? t("brandProfileHelpTab1") : undefined}
                  onClick={() => { if (isBrand) openBrandProfile(item.name); else openExploreTopic(item.name); }}
                >
                  {isBrand ? t("brandProfileLabel") : t("exploreTopicLabel")} <ExternalLink size={14} />
                </button>
                <button
                  className="signalRowAction primary"
                  title={t("redditEvidenceHelpTab1")}
                  onClick={openThisEvidence}
                >
                  {t("redditEvidenceLabel")} <ArrowRight size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {filteredRows.length > visibleCount && <button className="loadMore" onClick={() => setVisibleCount((value) => value + 20)}>{t("loadMore")}</button>}
      </div>
    </div>
  );
}

type ScatterPoint = { cluster: Cluster; x: number; y: number; size: number };

// Fixed reference canvas the deconfliction math runs against -- the actual .scatter
// container is responsive (and can be zoomed 1x-3x), but the *relative* spacing produced
// here (in %) holds regardless of the container's real pixel size.
const SCATTER_CANVAS_WIDTH = 960;
const SCATTER_CANVAS_HEIGHT = 440;

// Bubble x/y come from absolute current_week_posts/unique_subreddits values, so most
// lower-volume clusters land on nearly the same handful of pixels near the origin and
// become visually indistinguishable/unclickable even though every cluster IS present in
// the data (see OpportunitySection's clusters prop, always the full filteredClusters set).
// This runs a few passes of simple pairwise separation so overlapping bubbles nudge apart
// into distinct, independently clickable circles without materially changing their
// relative position on the two axes.
function deconflictBubbles(clusters: Cluster[], maxPosts: number, maxSubreddits: number, maxTrend: number): ScatterPoint[] {
  const points: ScatterPoint[] = clusters.map((cluster) => ({
    cluster,
    x: 6 + Math.max(0, Math.min(1, cluster.current_week_posts / maxPosts)) * 88,
    y: 6 + Math.max(0, Math.min(1, cluster.unique_subreddits / maxSubreddits)) * 88,
    size: 16 + 34 * (cluster.trend_score / maxTrend)
  }));
  const PADDING = 4;
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        const ax = (a.x / 100) * SCATTER_CANVAS_WIDTH;
        const ay = (a.y / 100) * SCATTER_CANVAS_HEIGHT;
        const bx = (b.x / 100) * SCATTER_CANVAS_WIDTH;
        const by = (b.y / 100) * SCATTER_CANVAS_HEIGHT;
        let dx = bx - ax;
        let dy = by - ay;
        let distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = (a.size + b.size) / 2 + PADDING;
        if (distance >= minDistance) continue;
        if (distance === 0) {
          // Identical position (rare, e.g. two clusters with the same volume/reach) --
          // pick a stable pseudo-random direction so they don't stay stacked forever.
          const angle = (i * 97 + j * 53) % 360 * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const overlap = (minDistance - distance) / 2;
        const nx = (dx / distance) * overlap;
        const ny = (dy / distance) * overlap;
        a.x = Math.max(2, Math.min(98, a.x - (nx / SCATTER_CANVAS_WIDTH) * 100));
        a.y = Math.max(2, Math.min(98, a.y - (ny / SCATTER_CANVAS_HEIGHT) * 100));
        b.x = Math.max(2, Math.min(98, b.x + (nx / SCATTER_CANVAS_WIDTH) * 100));
        b.y = Math.max(2, Math.min(98, b.y + (ny / SCATTER_CANVAS_HEIGHT) * 100));
      }
    }
  }
  return points;
}

// Four exhaustive, mutually-exclusive quadrants split at the 0.5 percentile mark on both
// axes (recommended "standard" version in the spec, chosen over a 0.7/0.5 mixed-threshold
// split specifically because 0.7/0.5 leaves clusters in the 0.5-0.7 momentum band with no
// quadrant at all -- every cluster must land in exactly one bucket). Falls back to score/5
// when percentiles aren't present in the bundle.
function OpportunitySection({
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
  const maxPosts = maxOf(clusters.map((cluster) => cluster.current_week_posts), 1);
  const maxSubreddits = maxOf(clusters.map((cluster) => cluster.unique_subreddits), 1);
  const maxTrend = maxOf(clusters.map((cluster) => cluster.trend_score), 1);
  const dragOffset = (drag / 100) * (zoom - 1) * 100;
  const points = useMemo(
    () => deconflictBubbles(clusters, maxPosts, maxSubreddits, maxTrend),
    [clusters, maxPosts, maxSubreddits, maxTrend]
  );
  // Top clusters by trend_score get their label shown by default (not just on hover/
  // selection) so the map isn't a wall of anonymous circles for the highest-priority
  // categories; everything else still reveals its name on hover, and the selected
  // cluster's label is always on via the existing button.active + .scatterLabel rule.
  const labeledClusterIds = useMemo(() => new Set(
    [...clusters].sort((a, b) => b.trend_score - a.trend_score).slice(0, 18).map((cluster) => cluster.cluster_id)
  ), [clusters]);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const renderedIds = points.map((point) => point.cluster.cluster_id);
    const dataIds = clusters.map((cluster) => cluster.cluster_id);
    const missing = dataIds.filter((id) => !renderedIds.includes(id));
    const seen = new Set<string>();
    const duplicates = renderedIds.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    // eslint-disable-next-line no-console
    console.table({
      identityClusterCount: dataIds.length,
      renderedBubbleCount: renderedIds.length,
      missingClusterIds: missing.length ? missing.join(", ") : "(none)",
      duplicateClusterIds: duplicates.length ? duplicates.join(", ") : "(none)"
    });
  }, [points, clusters]);
  const hasPercentiles = (cluster: Cluster) => Number.isFinite(Number(cluster.momentum_percentile))
    && Number.isFinite(Number(cluster.cross_community_percentile));
  const momentumRank = (cluster: Cluster) => hasPercentiles(cluster) ? Number(cluster.momentum_percentile) : cluster.momentum_score / 5;
  const reachRank = (cluster: Cluster) => hasPercentiles(cluster) ? Number(cluster.cross_community_percentile) : cluster.cross_community_score / 5;
  const scaling = [...clusters]
    .filter((cluster) => momentumRank(cluster) >= 0.5 && reachRank(cluster) >= 0.5)
    .sort((a, b) => b.trend_score - a.trend_score
      || momentumRank(b) - momentumRank(a)
      || reachRank(b) - reachRank(a)
      || b.current_week_posts - a.current_week_posts)
    .slice(0, 5);
  const niche = [...clusters]
    .filter((cluster) => momentumRank(cluster) >= 0.5 && reachRank(cluster) < 0.5)
    .sort((a, b) => momentumRank(b) - momentumRank(a)
      || b.current_week_posts - a.current_week_posts
      || b.trend_score - a.trend_score
      || a.unique_subreddits - b.unique_subreddits)
    .slice(0, 5);
  // Highest trend_score cluster in the map always shows its name (not just on hover), and
  // gets the extra "pinned" emphasis treatment (backdrop pill) on top of the "labeled" set.
  const topTrendClusterId = clusters.length
    ? [...clusters].sort((a, b) => b.trend_score - a.trend_score)[0].cluster_id
    : "";
  return (
    <div className="opportunitySection">
      <article className="panel">
        <div className="panelHeader">
          <span>{t("quadrantKicker")}</span>
          <h3>{t("categoryOpportunityMap")}</h3>
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
            {points.map(({ cluster, x, y, size }) => {
              const isTop = cluster.cluster_id === topTrendClusterId;
              const isLabeled = labeledClusterIds.has(cluster.cluster_id);
              const tooltip = [
                cluster.cluster_name,
                `${t("bubbleTooltipPosts")}: ${cluster.current_week_posts.toLocaleString()}`,
                `${t("bubbleTooltipCommunities")}: ${cluster.unique_subreddits.toLocaleString()}`,
                `${t("bubbleTooltipTrendScore")}: ${fmt(cluster.trend_score, 1)}`
              ].join("\n");
              return (
                <div
                  key={cluster.cluster_id}
                  className={`scatterPoint ${isTop ? "pinned" : ""} ${isLabeled ? "labeled" : ""}`}
                  style={{ left: `${x}%`, bottom: `${y}%` }}
                >
                  <button
                    className={selectedClusterId === cluster.cluster_id ? "active" : ""}
                    title={tooltip}
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
      <div className="opportunityLists quadrantGrid quadrantGrid-half">
        <QuadrantColumn title={t("scalingOpportunities")} rows={scaling} openClusterDetail={openClusterDetail} />
        <QuadrantColumn title={t("emergingNicheOpportunities")} rows={niche} openClusterDetail={openClusterDetail} />
      </div>
    </div>
  );
}

function QuadrantColumn({ title, rows, openClusterDetail }: { title: string; rows: Cluster[]; openClusterDetail: (id: string) => void }) {
  const { t } = useLang();
  return (
    <div className="opportunityListColumn">
      <h4>{title}</h4>
      <div className="opportunityListRows">
        {!rows.length && <p className="emptyState">{t("noOpportunityCategories")}</p>}
        {rows.map((cluster, index) => (
          <button key={cluster.cluster_id} className="opportunityRow" onClick={() => openClusterDetail(cluster.cluster_id)}>
            <b>#{index + 1}</b>
            <CategoryAvatar name={cluster.cluster_name} illustrationUrl={cluster.illustration_url} size="sm" />
            <span>
              <strong>{cluster.cluster_name}</strong>
              <small>
                {cluster.current_week_posts} {t("postsUnit")} · {cluster.previous_week_posts === 0
                  ? t("newTag")
                  : `${cluster.growth_rate >= 0 ? "+" : ""}${Math.round(cluster.growth_rate * 100)}% WoW`} · {cluster.unique_subreddits} {t("subredditsUnit")}
              </small>
            </span>
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
  brandDomain?: string;
  clusterSignals: ClusterBrandSignal[];
  aliases: string[];
  url: string;
  logoUrl?: string;
  cluster_id?: string;
  cluster_name?: string;
};

function SignalsTab({
  clusters,
  signalCards,
  selectedSignalKey,
  signalScope,
  brandQuery,
  signalSort,
  signalCategoryId,
  setSignalScope,
  setBrandQuery,
  setSignalSort,
  setSignalCategoryId,
  setSelectedSignalKey,
  sparkle,
  setSelectedClusterId,
  setTab,
  openEvidence
}: {
  clusters: Cluster[];
  signalCards: SignalCard[];
  selectedSignalKey: string;
  signalScope: SignalScope;
  brandQuery: string;
  signalSort: SignalSort;
  signalCategoryId: string;
  setSignalScope: (value: SignalScope) => void;
  setBrandQuery: (value: string) => void;
  setSignalSort: (value: SignalSort) => void;
  setSignalCategoryId: (value: string) => void;
  setSelectedSignalKey: (value: string) => void;
  sparkle: SparkleData;
  setSelectedClusterId: (id: string) => void;
  setTab: (tab: ExploreTab) => void;
  openEvidence: (target: EvidenceTarget) => void;
}) {
  const { lang, t } = useLang();
  const selected = signalCards.find((item) => item.key === selectedSignalKey);
  const [visibleCount, setVisibleCount] = useState(20);
  const [visibleSignals, setVisibleSignals] = useState(40);
  const [clusterPickerOpen, setClusterPickerOpen] = useState(false);
  const upperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setVisibleCount(20), [brandQuery, signalScope, signalSort, signalCategoryId]);
  useEffect(() => setClusterPickerOpen(false), [selectedSignalKey]);
  useEffect(() => setVisibleSignals(40), [sparkle.current_week]);
  const maxUniquePosts = maxOf(signalCards.map((item) => item.uniquePosts), 1);
  const sortedCategories = useMemo(() => [...clusters].sort((a, b) => a.cluster_name.localeCompare(b.cluster_name)), [clusters]);
  const illustrationByClusterId = useMemo(() => {
    const map = new Map<string, string>();
    clusters.forEach((cluster) => map.set(cluster.cluster_id, cluster.illustration_url || ""));
    return map;
  }, [clusters]);

  // Evidence is keyed by week x cluster x brand/keyword -- a signal discussed in more than
  // one category needs the user to pick which category's posts to view. That picker only
  // ever appears as part of this action, never as a persistent cluster list in the detail
  // body (the spec explicitly drops "Appears in N categories" from the signal detail).
  const openSignalEvidence = (item: SignalCard, clusterId?: string) => {
    const target = clusterId
      ? item.clusterSignals.find((signal) => signal.cluster_id === clusterId)
      : [...item.clusterSignals].sort((a, b) => b.unique_posts - a.unique_posts)[0];
    if (!target) return;
    openEvidence(item.kind === "brand"
      ? { kind: "brand", clusterId: target.cluster_id, brandNorm: item.key.slice(6), display: item.display }
      : { kind: "keyword", clusterId: target.cluster_id, termNorm: item.key.slice(8), display: item.display });
  };

  const selectSignalFromSparkle = (signal: SparkleSignal) => {
    if (signal.source_type !== "confirmed_whitelist_brand") setSignalScope("brands_and_keywords");
    setSelectedSignalKey(`${signal.kind}:${signal.signal_norm}`);
    upperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="signalsTabPage">
      <div className="mappingGrid signalsUpperGrid" ref={upperRef}>
        <article className="panel">
          <div className="panelHeader">
            <span>{t("signalDetailKicker")}</span>
            <h3>{t("signalDetailTitle")}</h3>
          </div>
          <div className="barGraphFilters">
            <label className="categoryFilterSelect">
              {t("categoryFilterLabel")}
              <select value={signalCategoryId} onChange={(event) => setSignalCategoryId(event.target.value)}>
                <option value="all">{t("allCategoriesOption")}</option>
                {sortedCategories.map((cluster) => (
                  <option key={cluster.cluster_id} value={cluster.cluster_id}>{cluster.cluster_name}</option>
                ))}
              </select>
            </label>
            <div className="scopeToggle" role="tablist">
              <button role="tab" aria-selected={signalScope === "verified_brands"} className={signalScope === "verified_brands" ? "active" : ""} onClick={() => setSignalScope("verified_brands")}>
                {t("signalScopeVerified")}
              </button>
              <button role="tab" aria-selected={signalScope === "brands_and_keywords"} className={signalScope === "brands_and_keywords" ? "active" : ""} onClick={() => setSignalScope("brands_and_keywords")}>
                {t("signalScopeAll")}
              </button>
            </div>
            <input value={brandQuery} onChange={(event) => setBrandQuery(event.target.value)} placeholder={t("searchSignalsPlaceholder")} />
            <select value={signalSort} onChange={(event) => setSignalSort(event.target.value as SignalSort)}>
              <option value="volume">{t("sortVolume")}</option>
              <option value="mentions">{t("sortMentions")}</option>
              <option value="positive">{t("sortPositive")}</option>
            </select>
          </div>
          <div className="sentimentLegend">
            <span className="sentimentLegendLabel">{t("sentimentLegendLabel")}</span>
            <em>{t("sentimentLegendNegative")}</em>
            <span className="sentimentLegendBar" aria-hidden="true" />
            <em>{t("sentimentLegendPositive")}</em>
          </div>
          <div className="barGraphList">
            {!signalCards.length && <p className="emptyState">{t("noSignalData")}</p>}
            {signalCards.slice(0, visibleCount).map((item) => {
              const width = Math.max(4, (item.uniquePosts / maxUniquePosts) * 100);
              const tooltip = `${item.display} · ${item.uniquePosts} ${t("postsUnit")} · ${item.mentions} ${t("mentionsUnit")} · ${sentimentTag(lang, sentimentClass(item.sentiment) as SentimentKey)}`;
              return (
                <button
                  key={item.key}
                  className={`barGraphRow ${selectedSignalKey === item.key ? "active" : ""}`}
                  onClick={() => setSelectedSignalKey(item.key)}
                  title={tooltip}
                  aria-label={tooltip}
                >
                  <span className="barGraphLabel"><b>{item.display}</b></span>
                  <span className="barGraphTrack">
                    <i style={{ width: `${width}%`, background: sentimentGradientColor(item.sentiment) }} />
                  </span>
                </button>
              );
            })}
            {signalCards.length > visibleCount && <button className="loadMore" onClick={() => setVisibleCount((value) => value + 20)}>{t("loadMore")}</button>}
          </div>
        </article>
        <article className="panel stickyPanel">
          <div className="panelHeader">
            <span>{t("selectedSignalKicker")}</span>
          </div>
          {!selected && (
            <div className="signalEmptyState">
              <p className="emptyStateTitle">{t("selectSignalPrompt")}</p>
              <p className="emptyStateBody">{t("selectSignalBody")}</p>
            </div>
          )}
          {selected && (
            <div className="brandProfileCard">
              <BrandAvatar
                name={selected.display}
                logoUrl={selected.kind === "brand" ? selected.logoUrl : ""}
                signalType={selected.kind === "brand" ? selected.tag : undefined}
                size="xl"
              />
              <strong className="brandProfileName">{selected.display}</strong>
              <span className={selected.kind === "brand" ? `brandTypeBadge ${brandTypeClass(selected.tag)}` : "brandTypeBadge known"}>
                {selected.kind === "brand" ? brandTypeLabel(selected.tag, lang, selected.brandDomain) : t("keywordPhraseLabel")}
              </span>
              <div className="brandProfileDivider" />
              <div className="metricGrid">
                <Stat label={t("discussionPosts")} value={`${selected.uniquePosts} ${t("postsUnit")}`} />
                <Stat label={t("statFrequency")} value={`${selected.mentions} ${t("mentionsUnit")}`} />
                <Stat label={t("statSentiment")} value={sentimentTag(lang, sentimentClass(selected.sentiment) as SentimentKey)} />
              </div>
              <div className="brandProfileDivider" />
              <div className="signalActions">
                <button
                  className="primaryLink"
                  onClick={() => selected.kind === "brand" ? openBrandProfile(selected.display) : openExploreTopic(selected.display)}
                  title={selected.kind === "brand" ? t("brandProfileHelpTab1") : undefined}
                >
                  {selected.kind === "brand" ? t("brandProfileLabel") : t("exploreTopicLabel")} <ExternalLink size={12} />
                </button>
                {selected.clusterSignals.length <= 1 ? (
                  <button className="primaryLink" title={t("redditEvidenceHelpTab2")} onClick={() => openSignalEvidence(selected)}>
                    {t("redditEvidenceLabel")} <ExternalLink size={12} />
                  </button>
                ) : (
                  <div className="clusterPicker">
                    <button className="primaryLink" title={t("redditEvidenceHelpTab2")} onClick={() => setClusterPickerOpen((value) => !value)}>
                      {t("redditEvidenceLabel")} <ChevronDown size={12} />
                    </button>
                    {clusterPickerOpen && (
                      <div className="clusterPickerMenu">
                        <p>{t("chooseClusterForEvidence")}</p>
                        {[...selected.clusterSignals].sort((a, b) => b.unique_posts - a.unique_posts).map((signal) => (
                          <button key={signal.cluster_id} onClick={() => { setClusterPickerOpen(false); openSignalEvidence(selected, signal.cluster_id); }}>
                            {signal.cluster_name} · {signal.unique_posts} {t("postsUnit")}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </article>
      </div>

      <div className="sparkleSection">
        {sparkle.status === "insufficient_comparison_weeks" ? (
          <article className="panel"><p className="emptyState">{t("sparkleInsufficientWeeks")}</p></article>
        ) : (
          <>
            <p className="sparkleDefinition">{t("sparkleDefinition")}</p>
            <div className="mappingGrid">
              <article className="panel">
                <div className="panelHeader">
                  <span>{t("freshKicker")}</span>
                  <h3>{t("newlyActiveCategoriesShort")}</h3>
                </div>
                <div className="sparkleList"><div className="sparkleGroup">
                    {!sparkle.newly_active_clusters.length && <p className="emptyState">{t("noNewCategoriesMsg")}</p>}
                    {sparkle.newly_active_clusters.map((cluster) => (
                      <button
                        key={cluster.cluster_id}
                        className="newClusterRow"
                        onClick={() => {
                          setSelectedClusterId(cluster.cluster_id);
                          setTab("category");
                        }}
                      >
                        <b>{t("newTag")}</b>
                        <CategoryAvatar name={cluster.cluster_name} illustrationUrl={illustrationByClusterId.get(cluster.cluster_id)} size="sm" />
                        <span>
                          <strong>{cluster.cluster_name}</strong>
                          <small>
                            {cluster.current_week_posts} {t("postsUnit")} · {cluster.unique_subreddits} {t("subredditsUnit")}
                          </small>
                        </span>
                        <ArrowRight size={16} className="rowArrow" />
                      </button>
                    ))}
                </div></div>
              </article>
              <article className="panel">
                <div className="panelHeader">
                  <span>{t("freshKicker")}</span>
                  <h3>{t("newBrandKeywordSignalsShort")}</h3>
                </div>
                <div className="sparkleList"><div className="sparkleGroup">
                    {!sparkle.new_signals.length && <p className="emptyState">{t("noNewSignalsMsg")}</p>}
                    {sparkle.new_signals.slice(0, visibleSignals).map((signal) => (
                      <button
                        key={`${signal.kind}:${signal.cluster_id}:${signal.signal_norm}`}
                        onClick={() => selectSignalFromSparkle(signal)}
                      >
                        {signal.kind === "brand"
                          ? <BrandAvatar name={signal.display} logoUrl={signal.logo_url} signalType={signal.source_type} size="md" />
                          : <BrandAvatar name={signal.display} size="md" />}
                        <span>
                          <strong>{signal.display}</strong>
                          <small>{signal.cluster_name} · {signal.unique_posts} {t("postsUnit")} · {signal.mentions} {t("mentionsUnit")}</small>
                          <span className="brandTypeBadge">{signal.ui_tag === "verified_brand" ? t("verifiedBrandTag") : t("brandKeywordTag")}</span>
                        </span>
                        <ArrowRight size={16} className="rowArrow" />
                      </button>
                    ))}
                    {sparkle.new_signals.length > visibleSignals && <button className="loadMore" onClick={() => setVisibleSignals((value) => value + 40)}>{t("loadMore")}</button>}
                </div></div>
              </article>
            </div>
          </>
        )}
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
        <button className="ghost" onClick={() => setTab("category")}>
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
                {t("openReddit")} <ExternalLink size={12} />
              </a>
            </div>
          </article>
        ))}
      </div>
    </article>
  );
}
