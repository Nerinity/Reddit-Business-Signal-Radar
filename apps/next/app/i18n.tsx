"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type Lang = "en" | "zh";

export const dimensionText = {
  trend_score: {
    en: { label: "Overall Trend", helper: "Overall opportunity ranking across growth, reach, sentiment, and engagement." },
    zh: { label: "综合趋势", helper: "综合讨论增长、扩散、情绪与参与度判断本周优先机会。" }
  },
  momentum_score: {
    en: { label: "Discussion Surge", helper: "Categories with the fastest week-over-week discussion growth." },
    zh: { label: "讨论激增", helper: "识别讨论量相比上一自然周增长最快的类目。" }
  },
  sentiment_score: {
    en: { label: "Positive Sentiment", helper: "Categories receiving the most positive consumer sentiment." },
    zh: { label: "情绪正面", helper: "识别消费者讨论整体态度更积极的类目。" }
  },
  cross_community_score: {
    en: { label: "Broad Reach", helper: "Categories spreading broadly across multiple communities." },
    zh: { label: "讨论高扩", helper: "识别讨论正在多个不同社区中广泛扩散的类目。" }
  },
  engagement_score: {
    en: { label: "High Engagement", helper: "Categories generating stronger comments, reactions, and engagement." },
    zh: { label: "参与度高", helper: "识别更容易引发评论、互动和持续讨论的类目。" }
  }
} as const;

export const momentumTagText = {
  emerging: { en: "Emerging", zh: "新兴" },
  exploding: { en: "Exploding", zh: "爆发式增长" },
  highEngagement: { en: "High Engagement", zh: "高互动" },
  broadAdoption: { en: "Broad Adoption", zh: "广泛采用" },
  risk: { en: "Risk", zh: "风险" },
  steady: { en: "Steady", zh: "平稳" }
} as const;

export const sentimentTagText = {
  positive: { en: "positive", zh: "正面" },
  negative: { en: "negative", zh: "负面" },
  neutral: { en: "neutral", zh: "中性" }
} as const;

const dict = {
  brandName: { en: "Reddit Product Trend Radar", zh: "Reddit 产品趋势雷达" },
  navHome: { en: "Home", zh: "首页" },
  navExplore: { en: "Explore", zh: "互动探索" },
  navAnalytics: { en: "Analytics", zh: "分析看板" },
  weekAria: { en: "Analysis week", zh: "分析周" },
  exportBtn: { en: "Export", zh: "导出" },
  loading: { en: "Loading Reddit Product Trend Radar...", zh: "正在加载 Reddit 产品趋势雷达..." },
  identityTitle: { en: "Choose Your Operations Team", zh: "选择你的运营身份" },
  identityBody: { en: "Select your Level 1 and Level 2 operations teams to view signals for the categories you manage.", zh: "选择所属一级与二级运营团队，进入后将只展示与你负责行业相关的类目信号。" },
  opsTeam1: { en: "Ops Team 1", zh: "一级运营团队" },
  opsTeam2: { en: "Ops Team 2", zh: "二级运营团队" },
  chooseOpsTeam1First: { en: "Select Ops Team 1 first", zh: "请先选择一级运营团队" },
  chooseOpsTeam2: { en: "Select Ops Team 2", zh: "请选择二级运营团队" },
  enterDashboard: { en: "Enter My Industry Dashboard", zh: "进入我的行业看板" },
  enterSignalDashboard: { en: "Enter Signal Dashboard", zh: "进入信号看板" },
  allView: { en: "All Teams · All Categories", zh: "全部视角 · 全部类目" },
  allTeams: { en: "All Teams", zh: "全部视角" },
  allCategoriesIdentity: { en: "All Categories", zh: "全部类目" },
  allViewDescription: { en: "For cross-functional users who need access to signals across all available categories.", zh: "适用于跨行业或非行业岗位，可查看当前产品中的全部类目信号。" },
  orChooseIndustry: { en: "Or select an industry team", zh: "或选择行业团队" },
  youWillView: { en: "You will view", zh: "你将查看" },
  youWillViewAll: { en: "You will view all", zh: "你将查看全部" },
  validCategories: { en: "available categories", zh: "个有效类目" },
  noMappedCategories: { en: "No categories are currently mapped to this team. Please check the mapping configuration.", zh: "当前团队暂未配置可查看类目，请检查映射配置。" },
  currentIdentity: { en: "Current Team", zh: "当前身份" },
  switchIdentity: { en: "Switch Team", zh: "切换身份" },
  clearIdentity: { en: "Clear saved identity", zh: "清除已保存身份" },
  categoriesAvailable: { en: "categories available", zh: "个类目可查看" },
  invalidIdentity: { en: "Your saved team configuration is no longer valid. Please select again.", zh: "身份配置已失效，请重新选择。" },
  outOfScopeCategory: { en: "This category is outside your operations scope.", zh: "当前类目不在你的运营范围内。" },
  noTeamSignals: { en: "No category signals are available for the selected operations team.", zh: "当前运营团队暂无可展示的类目信号。" },

  heroEyebrow: { en: "AI powered real consumer signals", zh: "AI 驱动的真实消费者信号" },
  heroTitle: { en: "Reddit - North America Product Trend Radar", zh: "Reddit - 北美消费趋势雷达" },
  heroBody: {
    en: "Identify emerging product opportunities from real consumer discussions before they appear in marketplace metrics.",
    zh: "在市场数据体现之前，从真实的消费者讨论中发现新兴的产品机会。"
  },
  statAnalysisWeek: { en: "Analysis Week", zh: "分析周期" },
  statRedditPosts: { en: "Reddit Posts", zh: "Reddit 帖子数" },
  statTrendClusters: { en: "Trend Clusters", zh: "趋势分类数" },
  statBrandSignals: { en: "Brand Signals", zh: "品牌信号数" },
  statWeeklyDiscussionPosts: { en: "Weekly Discussion Posts", zh: "当周讨论帖子数" },
  statWeeklyBrandSignals: { en: "Weekly Brand Signals", zh: "当周品牌信号" },
  statWeeklyKeywordBrandSignals: { en: "Weekly Keyword / Brand Signals", zh: "当周关键词 / 品牌信号" },
  statCoveredClusters: { en: "Covered Clusters", zh: "讨论覆盖类目数" },
  keywordsUnit: { en: "keywords", zh: "个关键词" },
  brandsUnit: { en: "brands", zh: "个品牌" },
  statAvgTrendScore: { en: "Avg Trend Score", zh: "平均趋势分" },

  exploreCardKicker: { en: "Interactive Product", zh: "互动产品" },
  exploreCardTitle: { en: "Explore Trends", zh: "探索趋势" },
  exploreCardBody: {
    en: "Find categories, keywords, brands, and evidence worth reviewing this week.",
    zh: "查看本周值得关注的品类、关键词、品牌与原始依据。"
  },
  exploreCardTag: {
    en: "For industry folks / AMs checking on their own category",
    zh: "如果你是行业人 / AM，想看看自己品类情况"
  },
  dashboardCardKicker: { en: "Analytics", zh: "分析" },
  dashboardCardTitle: { en: "Analytics Dashboard", zh: "分析看板" },
  dashboardCardBody: {
    en: "Validate scores, rankings, raw data, weekly movement, and keyword sentiment.",
    zh: "核对评分、排名、原始数据、每周变化与关键词情感。"
  },
  dashboardCardTag: {
    en: "For exploring the full data analysis / trend mining",
    zh: "如果你想探索完整数据分析 / 趋势挖掘"
  },

  exploreSectionKicker: { en: "Interactive Product", zh: "互动产品" },
  exploreSectionTitle: { en: "Explore Signals", zh: "探索信号" },
  exploreSectionBody: {
    en: "Interactive exploration layer for categories, opportunities, keywords, brands, and evidence.",
    zh: "用于品类、机会、关键词、品牌与依据的互动探索层。"
  },
  tabWord: { en: "Tab", zh: "标签" },
  tabTrend: { en: "Trend Categories", zh: "趋势品类" },
  tabOpportunity: { en: "Opportunity Discovery", zh: "机会发现" },
  tabMapping: { en: "Keyword / Brand Detail", zh: "关键词 / 品牌详情" },
  tabSparkle: { en: "New & Emerging", zh: "新兴信号" },

  dimPanelKicker: { en: "Signal Dimensions", zh: "信号维度" },
  dimPanelTitle: { en: "Rank by score dimension", zh: "按评分维度排序" },
  analysisView: { en: "Analysis View", zh: "当前分析视角" },
  analysisViewHint: { en: "Switching views re-ranks categories and opens the top result.", zh: "切换视角将重新排序类目，并自动打开本维度第一名。" },
  communitiesUnit: { en: "communities", zh: "个社区" },
  positiveUnit: { en: "positive", zh: "正面" },
  categoryDiscussionShare: { en: "of category discussions", zh: "占该类目讨论" },
  noCommunityData: { en: "No community data is available for this category.", zh: "当前类目暂无社区分布数据。" },
  noSignalData: { en: "No qualifying brand or keyword signals are available.", zh: "当前类目暂无符合条件的品牌或关键词信号。" },
  rankKicker: { en: "Ranking", zh: "排名" },
  rankTitle: { en: "Trend Categories", zh: "趋势品类" },
  postsUnit: { en: "posts", zh: "篇帖子" },
  subsUnit: { en: "subs", zh: "个子版块" },
  subredditsUnit: { en: "subreddits", zh: "个子版块" },
  sortedBy: { en: "sorted by", zh: "排序依据" },
  detailKicker: { en: "Category Detail", zh: "品类详情" },
  activeSources: { en: "Active sources", zh: "活跃来源" },
  topicLandscape: { en: "Topic landscape", zh: "话题概览" },
  relatedBrandsKeywords: { en: "Related brands & keywords", zh: "相关品牌与关键词" },
  learnMoreBrand: { en: "Learn more about the brand", zh: "了解更多品牌信息" },
  evidenceBtn: { en: "Evidence", zh: "查看依据" },

  quadrantKicker: { en: "Opportunity Quadrant", zh: "机会象限" },
  quadrantTitle: { en: "Discussion Volume x Cross-Community Map", zh: "讨论度 x 跨社区数地图" },
  xZoom: { en: "X Zoom", zh: "X 轴缩放" },
  dragRight: { en: "Drag Right", zh: "向右拖动" },
  axisHighMomentum: { en: "Cross-community count", zh: "跨社区数" },
  axisReach: { en: "Discussion volume", zh: "讨论度" },
  listHighHigh: { en: "Top 5 High-Growth, Broad-Reach Categories", zh: "高热 + 高扩 Top 5" },
  listHighLow: { en: "Top 5 High-Growth, Niche Categories", zh: "高热 + 高垂 Top 5" },
  noOpportunityCategories: { en: "No categories meet the criteria this week.", zh: "本周暂无符合条件的类目。" },

  signalDetailKicker: { en: "Signal Detail", zh: "信号详情" },
  signalDetailTitle: { en: "Keyword / Brand Detail", zh: "关键词 / 品牌详情" },
  onlyBrand: { en: "Only Brand", zh: "仅品牌" },
  searchBrandPlaceholder: { en: "Search brand", zh: "搜索品牌" },
  allCategoriesPlaceholder: { en: "All categories", zh: "所有品类" },
  selectedSignalKicker: { en: "Selected Signal", zh: "已选信号" },
  chooseSignal: { en: "Choose a signal", zh: "请选择一个信号" },
  brandSignalLabel: { en: "Brand signal", zh: "品牌信号" },
  keywordPhraseLabel: { en: "Keyword / product phrase", zh: "关键词 / 产品短语" },
  statFrequency: { en: "Frequency", zh: "出现频率" },
  statSentiment: { en: "Sentiment", zh: "情感倾向" },
  statTag: { en: "Tag", zh: "标签" },
  statAppearsIn: { en: "Appears in", zh: "出现于" },
  mentionsUnit: { en: "mentions", zh: "次提及" },
  categoriesUnit: { en: "categories", zh: "个品类" },
  categoriesHeading: { en: "Categories", zh: "所属品类" },
  discussionPosts: { en: "Discussion posts", zh: "讨论帖子数" },
  trustedBrands: { en: "Verified + Known", zh: "白名单 + 已知品牌" },
  allBrands: { en: "All", zh: "全部" },
  verifiedBrands: { en: "Verified", zh: "白名单" },
  knownBrands: { en: "Known", zh: "已知" },
  candidateBrands: { en: "Candidate", zh: "候选" },
  businessPriority: { en: "Business Priority", zh: "业务优先级" },
  mostDiscussed: { en: "Most Discussed", zh: "讨论最多" },
  loadMore: { en: "Load More", zh: "加载更多" },

  categoryFilter: { en: "Category Filter", zh: "品类筛选" },
  overallAllCategories: { en: "Overall / All categories", zh: "总体 / 所有品类" },
  freshKicker: { en: "Fresh Signals", zh: "新增信号" },
  freshTitle: { en: "New & Emerging", zh: "新兴信号" },
  sparkleDefinition: { en: "This page only shows categories and signals absent in both of the previous two full weeks but newly detected this week above the minimum discussion threshold.", zh: "本页仅展示此前连续两个完整自然周均未出现、但在本周首次出现并达到最低讨论门槛的类目与信号。" },
  sparkleInsufficientWeeks: { en: "Coverage for the previous two full weeks is insufficient, so new signals are not generated for this week.", zh: "前两个完整自然周的数据覆盖不足，暂不生成本周新出现信号。" },
  newActiveCategories: { en: "Newly Active Categories This Week", zh: "本周新活跃类目" },
  newActiveCategoriesHelp: { en: "Categories with no valid discussions in either prior full week that first reached the minimum discussion threshold this week.", zh: "此前连续两个完整自然周无有效讨论、本周首次达到最低讨论门槛的类目。" },
  newlyDetectedSignals: { en: "Newly Detected Signals This Week", zh: "本周新出现信号" },
  newlyDetectedSignalsHelp: { en: "Brand or keyword signals absent from this category in both prior full weeks and first detected this week.", zh: "此前连续两个完整自然周未在该类目出现、本周首次被识别到的品牌或关键词信号。" },
  verifiedBrandTag: { en: "Verified Brand", zh: "白名单品牌" },
  brandKeywordTag: { en: "Brand / Keyword", zh: "品牌 / 关键词" },
  noNewSparkleItems: { en: "No newly detected items meet the threshold this week.", zh: "本周暂无达到门槛的新出现项目。" },
  newCategories: { en: "New Categories", zh: "新品类" },
  newTag: { en: "NEW", zh: "新" },
  newBrandSignals: { en: "New Brand Signals", zh: "新品牌信号" },
  firstWeekPosts: { en: "First-week posts", zh: "首周帖子数" },
  spike: { en: "Spike", zh: "增幅" },
  subreddits: { en: "Subreddits", zh: "子版块数" },
  freshKeywords: { en: "Fresh keywords", zh: "新增关键词" },
  spikeWord: { en: "spike", zh: "增幅" },
  newRatioLabel: { en: "new", zh: "新增" },
  engagementUnit: { en: "engagement", zh: "互动度" },

  evidenceKicker: { en: "Evidence", zh: "依据" },
  evidenceTitleSuffix: { en: "Reddit Evidence", zh: "Reddit 依据" },
  backToCategory: { en: "Back to Category", zh: "返回品类" },
  openReddit: { en: "Open Reddit", zh: "打开 Reddit" },
  fallbackReddit: { en: "Reddit", zh: "Reddit" },
  fallbackUnknown: { en: "unknown", zh: "未知" },
  evidenceLoading: { en: "Loading source evidence...", zh: "正在加载原帖证据…" },
  noSignalEvidence: { en: "No source evidence is available for this signal.", zh: "当前信号暂无可用原帖证据。" },

  vizKicker: { en: "Visualization Board", zh: "可视化看板" },
  vizTitle: { en: "Analytics Dashboard", zh: "分析看板" },
  vizBody: {
    en: "Score validation, raw evidence, selected-category word cloud, daily movement, and keyword sentiment.",
    zh: "评分核对、原始依据、所选品类词云、每日走势与关键词情感。"
  },
  overallKicker: { en: "Overall", zh: "总体" },
  trendRankTitle: { en: "Category Trend Score Ranking", zh: "品类趋势分排名" },
  rankingSuffix: { en: "Ranking", zh: "排名" },
  rawDataKicker: { en: "Raw Data", zh: "原始数据" },
  rawDataTitle: { en: "Selected Category Reddit Rows", zh: "所选品类 Reddit 原始记录" },
  rawHeadBrandSignal: { en: "Brand / Signal", zh: "品牌 / 信号" },
  rawHeadPost: { en: "Post", zh: "帖子" },
  rawHeadSubreddit: { en: "Subreddit", zh: "子版块" },
  rawHeadSentiment: { en: "Sentiment", zh: "情感" },
  rawHeadUrl: { en: "URL", zh: "链接" },
  open: { en: "Open", zh: "打开" },
  topicKicker: { en: "Topic", zh: "话题" },
  wordCloudTitle: { en: "Word Cloud", zh: "词云" },
  weeklyTrendKicker: { en: "Weekly Trend", zh: "每周趋势" },
  dailyChartTitle: { en: "Daily Posts + Avg Sentiment", zh: "每日帖子数 + 平均情感" },
  keywordSentimentKicker: { en: "Keyword Sentiment", zh: "关键词情感" },
  keywordSentimentTitle: { en: "Keyword Sentiment", zh: "关键词情感" }
} as const;

export type TKey = keyof typeof dict;

function translate(lang: Lang, key: TKey): string {
  return dict[key][lang];
}

type LangContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TKey) => string;
};

const LangContext = createContext<LangContextValue | undefined>(undefined);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("zh");
  const t = (key: TKey) => translate(lang, key);
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang() {
  const context = useContext(LangContext);
  if (!context) throw new Error("useLang must be used within a LangProvider");
  return context;
}

export function dimensionLabel(lang: Lang, key: keyof typeof dimensionText) {
  return dimensionText[key][lang].label;
}

export function dimensionHelper(lang: Lang, key: keyof typeof dimensionText) {
  return dimensionText[key][lang].helper;
}

export function momentumLabel(lang: Lang, key: keyof typeof momentumTagText) {
  return momentumTagText[key][lang];
}

export function sentimentTag(lang: Lang, key: keyof typeof sentimentTagText) {
  return sentimentTagText[key][lang];
}
