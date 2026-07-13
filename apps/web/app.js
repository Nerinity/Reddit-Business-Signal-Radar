const state = {
  data: null,
  view: "home",
  exploreTab: "trend",
  selectedClusterId: null,
  sortBy: "trend_score",
  brandQuery: "",
  categoryFilter: "",
  onlyBrand: false,
  selectedSignalKey: "",
  opportunityZoom: 1,
  opportunityDrag: 0,
  dashboardCategoryId: "all",
  sparkleCategoryId: "all",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const fmt = (value, digits = 1) => Number(value || 0).toFixed(digits);
const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const scoreLabel = {
  trend_score: "Overall",
  momentum_score: "Momentum",
  sentiment_score: "Sentiment",
  cross_community_score: "Reach",
  engagement_score: "Engagement",
};

async function loadData() {
  const response = await fetch("./public/data/dashboard.json", { cache: "no-store" });
  state.data = await response.json();
  state.selectedClusterId = state.data.clusters[0]?.cluster_id || null;
  hydratePeriod();
  hydrateCategoryFilter();
  renderAll();
}

function hydratePeriod() {
  const select = $("#period-select");
  select.innerHTML = state.data.weeks.map((week) => `<option value="${week}">${week}</option>`).join("");
}

function hydrateCategoryFilter() {
  const options = $("#category-options");
  if (!options) return;
  options.innerHTML = [...state.data.clusters]
    .sort((a, b) => a.cluster_name.localeCompare(b.cluster_name))
    .map((cluster) => `<option value="${cluster.cluster_name}"></option>`)
    .join("");
}

function setView(view) {
  state.view = view;
  $$(".view").forEach((node) => node.classList.remove("active"));
  $(`#view-${view}`).classList.add("active");
  $$(".nav-link").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  renderAll();
}

function setExploreTab(tab) {
  state.exploreTab = tab;
  $$(".explore-tab").forEach((node) => node.classList.toggle("active", node.dataset.exploreTab === tab));
  $$(".explore-tab-view").forEach((node) => node.classList.toggle("active", node.dataset.tabView === tab));
}

function clusters() {
  return [...state.data.clusters].sort((a, b) => Number(b[state.sortBy] || 0) - Number(a[state.sortBy] || 0));
}

function renderAll() {
  if (!state.data) return;
  renderHeroStats();
  setExploreTab(state.exploreTab);
  renderGuideSortState();
  renderClusterList();
  renderClusterDetail();
  renderScatter();
  renderOpportunityLists();
  renderKeywordMap();
  renderEvidenceDetail();
  renderSparkleCategoryFilter();
  renderSparkle();
  renderRanking();
  renderDashboardCategoryFilter();
  renderDimensionCharts();
  renderDashboardRawData();
  renderDashboardWordCloud();
  renderDailyTrend();
  renderKeywordSentimentChart();
}

function setSortBy(sortKey) {
  if (!scoreLabel[sortKey]) return;
  state.sortBy = sortKey;
  const topCluster = clusters()[0];
  if (topCluster) state.selectedClusterId = topCluster.cluster_id;
  renderAll();
}

function openClusterDetail(clusterId) {
  state.selectedClusterId = clusterId;
  state.exploreTab = "trend";
  renderAll();
  requestAnimationFrame(() => {
    $("[data-tab-view='trend']")?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
}

function renderGuideSortState() {
  $$(".guide-grid [data-sort-key]").forEach((button) => {
    button.classList.toggle("active", button.dataset.sortKey === state.sortBy);
    button.setAttribute("aria-pressed", String(button.dataset.sortKey === state.sortBy));
  });
}

function renderHeroStats() {
  const meta = state.data.meta;
  const stats = [
    ["Analysis Week", meta.latest_week],
    ["Reddit Posts", meta.post_count.toLocaleString()],
    ["Trend Clusters", meta.cluster_count],
    ["Brand Signals", meta.brand_signal_count.toLocaleString()],
    ["Avg Trend Score", starRating(meta.avg_trend_score, "hero-stars")],
  ];
  $("#hero-statbar").innerHTML = stats.map(([label, value]) => `
    <div class="hero-stat"><strong>${value}</strong><span>${label}</span></div>
  `).join("");
}

function renderClusterList() {
  const list = $("#cluster-list");
  const rows = clusters().slice(0, 28);
  list.innerHTML = rows.map((cluster, index) => `
    <button class="cluster-row ${cluster.cluster_id === state.selectedClusterId ? "active" : ""}" data-cluster-id="${cluster.cluster_id}">
      <span class="rank-badge">${String(index + 1).padStart(2, "0")}</span>
      <span class="cluster-thumb" style="--thumb:${clusterHue(cluster.cluster_name)}">${clusterInitials(cluster.cluster_name)}</span>
      <span>
        <span class="row-title">${cluster.cluster_name}</span>
        <span class="row-meta">
          <span>${cluster.current_week_posts} posts</span>
          <span>${cluster.unique_subreddits} subs</span>
          <span>sorted by ${scoreLabel[state.sortBy]}</span>
        </span>
      </span>
      <span class="row-arrow">›</span>
    </button>
  `).join("");
  $$(".cluster-row").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedClusterId = button.dataset.clusterId;
      renderAll();
    });
  });
}

function clusterInitials(name) {
  return String(name || "")
    .split(/\s|&/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function clusterHue(name) {
  const sum = String(name || "").split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return `${sum % 360}deg`;
}

function selectedCluster() {
  return state.data.clusters.find((cluster) => cluster.cluster_id === state.selectedClusterId) || state.data.clusters[0];
}

function selectedDashboardCluster() {
  if (state.dashboardCategoryId === "all") return null;
  return state.data.clusters.find((cluster) => cluster.cluster_id === state.dashboardCategoryId) || selectedCluster();
}

function dashboardPosts() {
  const cluster = selectedDashboardCluster();
  return cluster ? clusterPosts(cluster.cluster_id) : state.data.posts;
}

function dashboardTerms() {
  const cluster = selectedDashboardCluster();
  if (cluster) return cluster.terms;
  const grouped = new Map();
  state.data.keywords.forEach((term) => {
    const key = String(term.term || "").toLowerCase();
    if (!key) return;
    const current = grouped.get(key) || { term: term.term, mentions: 0, weightedSentiment: 0 };
    const mentions = Number(term.mentions || 0);
    current.mentions += mentions;
    current.weightedSentiment += Number(term.sentiment || 0) * Math.max(mentions, 1);
    grouped.set(key, current);
  });
  return [...grouped.values()]
    .map((term) => ({ ...term, sentiment: term.weightedSentiment / Math.max(term.mentions, 1) }))
    .sort((a, b) => Number(b.mentions || 0) - Number(a.mentions || 0))
    .slice(0, 24);
}

function renderClusterDetail() {
  const cluster = selectedCluster();
  if (!cluster) return;
  const posts = clusterPosts(cluster.cluster_id);
  $("#detail-title").textContent = cluster.cluster_name;
  $("#cluster-detail").innerHTML = `
    <div class="detail-body">
      <div class="star-score-grid compact">
        ${starMetric("Overall", cluster.trend_score)}
        ${starMetric("Momentum", cluster.momentum_score)}
        ${metric("Sentiment", sentimentBadge(cluster.avg_sentiment))}
        ${starMetric("Reach", cluster.cross_community_score)}
        ${starMetric("Engagement", cluster.engagement_score)}
      </div>
      <div class="signal-section">
        <h4>Active sources</h4>
        <div class="source-grid">
          ${subredditSources(posts).map((source) => sourceCard(source)).join("") || "<span class='muted'>No subreddit source yet</span>"}
        </div>
      </div>
      <div class="signal-section">
        <h4>Topic landscape</h4>
        <div class="detail-word-cloud">
          ${cluster.terms.map((term) => wordCloudTerm(term, cluster)).join("") || "<span class='muted'>No topic terms</span>"}
        </div>
      </div>
      <div class="signal-section">
        <h4>Related brands & keywords</h4>
        <div class="product-card-scroll">
          ${detailProductCards(cluster).map((item) => productSignalCard(item, cluster)).join("") || "<span class='muted'>No related product cards</span>"}
        </div>
      </div>
    </div>
  `;
  attachLogoFallbacks($("#cluster-detail"));
  attachEvidenceHandlers($("#cluster-detail"));
}

function clusterPosts(clusterId) {
  return state.data.posts.filter((post) => post.cluster_id === clusterId);
}

function subredditSources(posts) {
  const bySub = new Map();
  posts.forEach((post) => {
    const name = post.subreddit || "unknown";
    const current = bySub.get(name) || { subreddit: name, posts: 0, sampleTitle: post.title, sampleUrl: post.url };
    current.posts += 1;
    if (!current.sampleUrl && post.url) current.sampleUrl = post.url;
    bySub.set(name, current);
  });
  return [...bySub.values()].sort((a, b) => b.posts - a.posts).slice(0, 5);
}

function sourceCard(source) {
  return `
    <a class="source-card" href="https://www.reddit.com/r/${encodeURIComponent(source.subreddit)}" target="_blank" rel="noreferrer">
      <span class="source-logo">r/</span>
      <span>
        <strong>r/${source.subreddit}</strong>
        <small>${source.posts} posts · open community ↗</small>
      </span>
    </a>
  `;
}

function wordCloudTerm(term, cluster) {
  const maxMentions = Math.max(...cluster.terms.map((row) => row.mentions || 0), 1);
  const size = 13 + 18 * ((term.mentions || 0) / maxMentions);
  const sentiment = term.sentiment >= 0.15 ? "positive" : term.sentiment <= -0.08 ? "negative" : "neutral";
  return `<button class="detail-keyword ${sentiment}" style="--size:${size}px" data-evidence-cluster="${cluster.cluster_id}">${term.term}</button>`;
}

function detailProductCards(cluster) {
  const brandItems = cluster.brands.map((brand) => ({ ...brand, kind: "brand", display: brand.brand_display, sentiment: brand.sentiment, url: brand.google_search_url }));
  const termItems = cluster.terms.map((term) => ({ ...term, kind: "keyword", display: term.term, url: "" }));
  return [...brandItems, ...termItems].sort((a, b) => Number(b.mentions || 0) - Number(a.mentions || 0)).slice(0, 18);
}

function productSignalCard(item, cluster) {
  const sentiment = item.sentiment >= 0.15 ? "positive" : item.sentiment <= -0.08 ? "negative" : "neutral";
  const tag = item.kind === "brand" ? brandTag(item.brand_signal_type) : entityTag(item.entity_type);
  const googleUrl = item.kind === "brand" ? (item.url || googleBrandSearchUrl(item.display)) : "";
  return `
    <article class="product-signal-card ${item.kind}">
      ${signalAvatar(item)}
      <div class="product-card-main">
        <strong>${item.display}</strong>
        <small>${tag || item.kind} · <span class="${sentiment}">${sentimentLabel(sentiment)}</span> · ${item.mentions || 0} mentions</small>
      </div>
      <div class="signal-card-actions">
        ${item.kind === "brand" ? `<a href="${googleUrl}" target="_blank" rel="noreferrer">Learn more about the brand</a>` : ""}
        <button type="button" data-evidence-cluster="${cluster.cluster_id}">Evidence</button>
      </div>
    </article>
  `;
}

function signalAvatar(item) {
  if (item.kind !== "brand") return `<span class="product-logo">#</span>`;
  const initials = clusterInitials(item.display);
  if (item.logo_url) {
    return `<span class="brand-avatar-slot small" data-initials="${initials}"><img class="brand-logo-img" src="${item.logo_url}" alt="" loading="lazy"></span>`;
  }
  return `<span class="brand-avatar-slot small is-placeholder" data-initials="${initials}"><span class="google-mark">G</span>${initials}</span>`;
}

function attachEvidenceHandlers(root) {
  root.querySelectorAll("[data-evidence-cluster]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      state.selectedClusterId = event.currentTarget.dataset.evidenceCluster;
      state.exploreTab = "evidence";
      renderAll();
    });
  });
}

function renderEvidenceDetail() {
  const detail = $("#evidence-detail");
  if (!detail) return;
  const cluster = selectedCluster();
  const posts = clusterPosts(cluster?.cluster_id).slice(0, 24);
  $("#evidence-title").textContent = `${cluster?.cluster_name || "Selected Category"} · Reddit Evidence`;
  detail.innerHTML = `
    <div class="evidence-toolbar">
      <span>${posts.length} matched Reddit posts</span>
      <span>Evidence shown here mirrors the post-level evidence section from Analytics.</span>
    </div>
    <div class="evidence-post-grid">
      ${(posts.length ? posts : state.data.posts.slice(0, 12)).map((post) => evidencePost(post)).join("")}
    </div>
  `;
}

function evidencePost(post) {
  return `
    <article class="evidence-post-card">
      <div class="post-line"><strong>${post.title}</strong><span class="muted">r/${post.subreddit}</span></div>
      <p>${post.context_window || post.text_snippet || ""}</p>
      <div class="post-line">
        <span>${post.brand_display || "Reddit"} · ${post.sentiment_label || "neutral"}</span>
        <a href="${post.url}" target="_blank" rel="noreferrer">Open Reddit</a>
      </div>
    </article>
  `;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function starRating(value, className = "") {
  const score = Math.max(0, Math.min(5, Number(value || 0)));
  const full = Math.round(score);
  const stars = Array.from({ length: 5 }, (_, i) => `<span class="${i < full ? "on" : ""}">${i < full ? "★" : "☆"}</span>`).join("");
  return `<span class="star-rating ${className}" title="${fmt(score, 1)} out of 5">${stars}</span>`;
}

function starMetric(label, value) {
  const score = Math.max(0, Math.min(5, Number(value || 0)));
  return `<div class="star-metric"><span>${label}</span><strong>${starRating(score)}</strong></div>`;
}

// Brand image card: one shared component behind both the compact "Brand signals" list
// and the larger "Brand visuals" grid. No data source supplies a real logo_url today,
// so every card renders the initials-on-gradient placeholder and its click target is a
// Google Images search for the brand -- a manual, ToS-safe way to actually go look at the
// brand's imagery, since nothing here scrapes or hotlinks Google's results automatically.
// The moment a pipeline step starts writing logo_url, cards for that brand switch to a
// real <img> and the click target switches to opening that image directly, with no
// further changes needed here.
function brandImageSearchUrl(brand) {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${brand.brand_display} brand logo product`)}`;
}

function googleBrandSearchUrl(name) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} brand`)}`;
}

function brandImageCard(brand, variant) {
  const initials = clusterInitials(brand.brand_display);
  const tag = brandTag(brand.brand_signal_type);
  const hasLogo = Boolean(brand.logo_url);
  const clickUrl = hasLogo ? brand.logo_url : brandImageSearchUrl(brand);
  const avatar = hasLogo
    ? `<span class="brand-avatar-slot" data-initials="${initials}"><img class="brand-logo-img" src="${brand.logo_url}" alt="" loading="lazy"></span>`
    : `<span class="brand-avatar-slot is-placeholder" data-initials="${initials}"><span class="google-mark">G</span>${initials}</span>`;
  const label = variant === "visual"
    ? `<strong>${brand.brand_display}</strong><small>${brand.mentions} mentions · ${tag}</small>`
    : `<span><strong>${brand.brand_display}</strong><small>${brand.mentions} mentions · ${tag}</small></span>`;
  const affordance = variant === "visual"
    ? `<small class="brand-card-affordance">${hasLogo ? "Open logo ↗" : "Google Images ↗"}</small>`
    : "";
  const titleText = hasLogo ? `Open ${brand.brand_display} logo` : `Search “${brand.brand_display}” on Google Images`;
  return `
    <a class="brand-image-card ${variant}" href="${clickUrl}" target="_blank" rel="noreferrer" title="${titleText}">
      ${avatar}
      ${label}
      ${affordance}
    </a>
  `;
}

// Swaps a logo_url <img> to the initials placeholder if the image itself fails to
// load (e.g. a stale or dead logo URL) -- this is distinct from the "no logo_url at
// all" case, which already renders the placeholder directly and never hits this path.
function attachLogoFallbacks(root) {
  root.querySelectorAll(".brand-logo-img").forEach((img) => {
    img.addEventListener("error", () => {
      const slot = img.closest(".brand-avatar-slot");
      if (!slot) return;
      slot.classList.add("is-placeholder");
      slot.innerHTML = `<span class="google-mark">G</span>${slot.dataset.initials || ""}`;
    }, { once: true });
  });
}

function brandTag(type) {
  if (!type) return "other";
  return String(type).replaceAll("_", " ");
}

function entityTag(type) {
  if (!type) return "keyword";
  const normalized = type.replaceAll("_", " ");
  const labels = {
    "product phrase": "product phrase",
    "category keyword": "category keyword",
    "need state": "need state",
    "ingredient material": "ingredient/material",
    "product line": "product line",
    "retailer channel": "retailer/channel",
    "unknown candidate": "unknown candidate",
  };
  return labels[normalized] || normalized;
}

function sentimentLabel(sentiment) {
  if (sentiment === "positive") return "positive";
  if (sentiment === "negative") return "negative";
  return "neutral";
}

function sentimentTag(value) {
  const score = Number(value || 0);
  if (score >= 0.15) return "positive";
  if (score <= -0.08) return "negative";
  return "neutral";
}

function sentimentBadge(value) {
  const score = Number(value || 0);
  const tag = sentimentTag(score);
  return `<span class="sentiment-badge ${tag}">${score >= 0 ? "+" : ""}${fmt(score, 2)} · ${tag}</span>`;
}

function renderScatter() {
  const maxPosts = Math.max(...state.data.clusters.map((cluster) => cluster.current_week_posts), 1);
  const zoom = Number(state.opportunityZoom || 1);
  const drag = Number(state.opportunityDrag || 0);
  const dragOffset = (drag / 100) * (zoom - 1) * 100;
  $("#opportunity-zoom-label").textContent = `${fmt(zoom, 1)}x`;
  $("#opportunity-drag-label").textContent = `${Math.round(drag)}%`;
  $("#opportunity-scatter").innerHTML = `
    <div class="scatter-zoom" style="--zoom:${zoom};--drag:${dragOffset}%">
      <span class="axis-label axis-top">High momentum</span>
      <span class="axis-label axis-right">Reach</span>
      <span class="axis-label axis-bottom">Lower reach</span>
      <span class="axis-label axis-left">Low momentum</span>
      ${state.data.clusters.slice(0, 60).map((cluster) => {
        const x = Math.min(96, Math.max(4, Number(cluster.cross_community_score || 0) * 18));
        const y = Math.min(92, Math.max(8, cluster.momentum_score * 18));
        const size = 8 + 22 * (cluster.current_week_posts / maxPosts);
        const color = cluster.sentiment_score >= 4 ? "rgba(45, 229, 141, 0.86)" : cluster.sentiment_score >= 3 ? "rgba(20, 241, 255, 0.78)" : "rgba(255, 63, 143, 0.78)";
        return `<button class="scatter-dot" title="${cluster.cluster_name}" style="--x:${x}%;--y:${y}%;--size:${size}px;--color:${color}" data-cluster-id="${cluster.cluster_id}"></button>`;
      }).join("")}
    </div>`;
  $$(".scatter-dot").forEach((dot) => dot.addEventListener("click", () => {
    state.selectedClusterId = dot.dataset.clusterId;
    renderAll();
  }));
}

function renderOpportunityLists() {
  const target = $("#opportunity-lists");
  if (!target) return;
  const broad = [...state.data.clusters]
    .sort((a, b) => ((b.momentum_score || 0) + (b.cross_community_score || 0)) - ((a.momentum_score || 0) + (a.cross_community_score || 0)))
    .slice(0, 10);
  const niche = [...state.data.clusters]
    .sort((a, b) => ((b.momentum_score || 0) - (b.cross_community_score || 0)) - ((a.momentum_score || 0) - (a.cross_community_score || 0)))
    .slice(0, 10);
  target.innerHTML = `
    <div class="opportunity-column">
      <h4>High Momentum + High Range</h4>
      ${broad.slice(0, 5).map((cluster, index) => opportunityRow(cluster, index)).join("")}
    </div>
    <div class="opportunity-column">
      <h4>High Momentum + Low Range</h4>
      ${niche.slice(0, 5).map((cluster, index) => opportunityRow(cluster, index)).join("")}
    </div>
  `;
  $$(".opportunity-item").forEach((item) => item.addEventListener("click", () => {
    openClusterDetail(item.dataset.clusterId);
  }));
}

function opportunityRow(cluster, index) {
  return `
    <button class="opportunity-item" data-cluster-id="${cluster.cluster_id}">
      <span class="rank-badge">${String(index + 1).padStart(2, "0")}</span>
      <span>
        <strong>${cluster.cluster_name}</strong>
        <small>${cluster.current_week_posts} posts · ${cluster.unique_subreddits} subreddits</small>
      </span>
      <span class="row-arrow">›</span>
    </button>
  `;
}

function renderKeywordMap() {
  const map = $("#keyword-map");
  if (!map) return;
  const cards = signalCards();
  if (!cards.some((item) => signalKey(item) === state.selectedSignalKey)) {
    state.selectedSignalKey = cards[0] ? signalKey(cards[0]) : "";
  }
  $("#only-brand-toggle")?.classList.toggle("active", state.onlyBrand);

  map.innerHTML = `
    <div class="map-note">
      <span>Signals are ranked by mention frequency. Click any row to inspect detail on the right.</span>
      <span>${state.categoryFilter || "All categories"} · ${cards.length} visible signals</span>
    </div>
    <div class="term-card-grid">
      ${cards.map((item, index) => termCard(item, index)).join("") || "<div class='empty-state'>No matching keyword or brand signals.</div>"}
    </div>
  `;
  $$(".term-card").forEach((item) => item.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    state.selectedSignalKey = item.dataset.signalKey;
    renderAll();
  }));
  renderSignalDetail(cards);
}

function signalCards() {
  const selectedCategory = state.categoryFilter.trim().toLowerCase();
  const brandQuery = state.brandQuery.trim().toLowerCase();
  const keywords = state.data.keywords.map((term) => ({ ...term, kind: "keyword", display: term.term, url: "" }));
  const brands = state.data.brands.map((brand) => ({
    ...brand,
    kind: "brand",
    display: brand.brand_display,
    sentiment: brand.avg_sentiment,
    url: brand.google_search_url,
  }));
  const filtered = [...keywords, ...brands]
    .filter((item) => !selectedCategory || item.cluster_name.toLowerCase() === selectedCategory)
    .filter((item) => !state.onlyBrand || item.kind === "brand")
    .filter((item) => !brandQuery || (item.kind === "brand" && item.display.toLowerCase().includes(brandQuery)))
  const grouped = new Map();
  filtered.forEach((item) => {
    const key = `${item.kind}:${String(item.display || "").toLowerCase()}`;
    const current = grouped.get(key) || {
      ...item,
      mentions: 0,
      weightedSentiment: 0,
      cluster_ids: [],
      cluster_names: [],
      tags: new Set(),
      sourceItems: [],
    };
    const mentions = Number(item.mentions || 0);
    current.mentions += mentions;
    current.weightedSentiment += Number(item.sentiment || 0) * Math.max(mentions, 1);
    if (!current.cluster_ids.includes(item.cluster_id)) current.cluster_ids.push(item.cluster_id);
    if (!current.cluster_names.includes(item.cluster_name)) current.cluster_names.push(item.cluster_name);
    current.tags.add(item.kind === "brand" ? brandTag(item.brand_signal_type) : entityTag(item.entity_type));
    current.sourceItems.push(item);
    if (!current.url && item.url) current.url = item.url;
    grouped.set(key, current);
  });
  return [...grouped.values()]
    .map((item) => ({ ...item, sentiment: item.weightedSentiment / Math.max(item.mentions, 1), tags: [...item.tags].filter(Boolean) }))
    .sort((a, b) => Number(b.mentions || 0) - Number(a.mentions || 0))
    .slice(0, 80);
}

function signalKey(item) {
  return `${item.kind}:${String(item.display || "").toLowerCase()}`;
}

function termCard(item, index) {
  const sentiment = item.sentiment >= 0.15 ? "positive" : item.sentiment <= -0.08 ? "negative" : "neutral";
  const tag = item.kind === "brand" ? (item.tags?.[0] || "brand") : (item.tags?.[0] || "keyword");
  return `
    <button class="term-card ${item.kind} ${signalKey(item) === state.selectedSignalKey ? "active" : ""}" data-cluster-id="${item.cluster_ids?.[0] || item.cluster_id}" data-signal-key="${signalKey(item)}">
      <span class="term-rank">#${index + 1}</span>
      <strong>${item.display}</strong>
      <span class="term-mini-tag ${sentiment}">${tag}</span>
    </button>
  `;
}

function renderSignalDetail(cards) {
  const detail = $("#signal-detail");
  if (!detail) return;
  const item = cards.find((card) => signalKey(card) === state.selectedSignalKey);
  if (!item) {
    $("#signal-detail-title").textContent = "Choose a keyword or brand";
    detail.innerHTML = "<div class='empty-state'>Select a signal from the left list.</div>";
    return;
  }
  const sentiment = item.sentiment >= 0.15 ? "positive" : item.sentiment <= -0.08 ? "negative" : "neutral";
  const tag = item.tags?.join(", ") || (item.kind === "brand" ? brandTag(item.brand_signal_type) : entityTag(item.entity_type));
  const clustersForSignal = (item.cluster_ids || [item.cluster_id])
    .map((id) => state.data.clusters.find((row) => row.cluster_id === id))
    .filter(Boolean);
  const primaryCluster = clustersForSignal[0] || state.data.clusters.find((row) => row.cluster_id === item.cluster_id);
  $("#signal-detail-title").textContent = item.display;
  detail.innerHTML = `
    <div class="detail-body">
      <div class="signal-hero ${item.kind}">
        ${signalHeroAvatar(item)}
        <div>
          <strong>${item.display}</strong>
          <small>${item.kind === "brand" ? "Brand signal" : "Keyword / product phrase"}</small>
        </div>
      </div>
      <div class="metric-grid two">
        ${metric("Frequency", `${item.mentions} mentions`)}
        ${metric("Sentiment", sentimentLabel(sentiment))}
        ${metric("Tag", tag)}
        ${metric("Appears in", `${clustersForSignal.length || 1} categories`)}
      </div>
      <div class="signal-section">
        <h4>Categories</h4>
        <div class="chip-list">
          ${clustersForSignal.map((cluster) => `<button class="chip chip-button" data-cluster-id="${cluster.cluster_id}">${cluster.cluster_name}</button>`).join("")}
        </div>
      </div>
      <div class="signal-section">
        <h4>Related category context</h4>
        <div class="chip-list">
          ${(primaryCluster?.terms || []).slice(0, 10).map((term) => `<span class="chip">${term.term} · ${term.mentions}</span>`).join("") || "<span class='muted'>No related terms</span>"}
        </div>
      </div>
      <div class="signal-section">
        ${item.kind === "brand" && item.url ? `<a class="primary-link" href="${item.url}" target="_blank" rel="noreferrer">Learn more about the brand</a>` : `<button class="primary-link" data-cluster-id="${primaryCluster?.cluster_id || item.cluster_id}" type="button">Open category detail</button>`}
      </div>
    </div>
  `;
  detail.querySelectorAll("[data-cluster-id]").forEach((button) => button.addEventListener("click", (event) => {
    openClusterDetail(event.currentTarget.dataset.clusterId);
  }));
  attachLogoFallbacks(detail);
}

function signalHeroAvatar(item) {
  if (item.kind !== "brand") return `<span class="signal-hero-avatar">#</span>`;
  const initials = clusterInitials(item.display);
  if (item.logo_url) {
    return `<span class="signal-hero-avatar brand-avatar-slot" data-initials="${initials}"><img class="brand-logo-img" src="${item.logo_url}" alt="" loading="lazy"></span>`;
  }
  return `<span class="signal-hero-avatar brand-avatar-slot is-placeholder" data-initials="${initials}"><span class="google-mark">G</span>${initials}</span>`;
}

function renderSparkleCategoryFilter() {
  const select = $("#sparkle-category-select");
  if (!select) return;
  select.innerHTML = [
    `<option value="all" ${state.sparkleCategoryId === "all" ? "selected" : ""}>Overall / All categories</option>`,
    ...[...state.data.clusters]
      .sort((a, b) => a.cluster_name.localeCompare(b.cluster_name))
      .map((cluster) => `<option value="${cluster.cluster_id}" ${cluster.cluster_id === state.sparkleCategoryId ? "selected" : ""}>${cluster.cluster_name}</option>`),
  ].join("");
}

function renderSparkle() {
  const rows = state.data.clusters
    .filter((cluster) => cluster.previous_week_posts === 0)
    .filter((cluster) => state.sparkleCategoryId === "all" || cluster.cluster_id === state.sparkleCategoryId)
    .sort((a, b) => b.current_week_posts - a.current_week_posts)
    .slice(0, 12);
  const brands = state.data.brands
    .filter((brand) => state.sparkleCategoryId === "all" || brand.cluster_id === state.sparkleCategoryId)
    .sort((a, b) => Number(b.mentions || 0) - Number(a.mentions || 0))
    .slice(0, 12);
  $("#sparkle-list").innerHTML = `
    <div class="sparkle-group">
      <h4>New Categories</h4>
      ${rows.map((cluster) => `
        <button class="sparkle-item" data-cluster-id="${cluster.cluster_id}">
          <span class="new-pill">NEW</span>
          <span><strong>${cluster.cluster_name}</strong><br><span class="muted">${cluster.current_week_posts} posts · ${cluster.unique_subreddits} subreddits</span></span>
          <span class="row-arrow">›</span>
        </button>
      `).join("") || "<span class='muted'>No first-week category in this filter.</span>"}
    </div>
    <div class="sparkle-group">
      <h4>New Brand Signals</h4>
      ${brands.map((brand) => `
        <button class="sparkle-item brand-sparkle-item" data-brand-key="brand:${String(brand.brand_display || "").toLowerCase()}" data-cluster-id="${brand.cluster_id}">
          ${signalAvatar({ ...brand, kind: "brand", display: brand.brand_display })}
          <span><strong>${brand.brand_display}</strong><br><span class="muted">${brand.mentions || 0} mentions · ${brandTag(brand.brand_signal_type)}</span></span>
          <span class="row-arrow">›</span>
        </button>
      `).join("") || "<span class='muted'>No brand signals in this filter.</span>"}
    </div>
  `;
  $$(".sparkle-item").forEach((item) => item.addEventListener("click", () => {
    if (item.dataset.brandKey) {
      state.selectedClusterId = item.dataset.clusterId;
      state.selectedSignalKey = item.dataset.brandKey;
      state.onlyBrand = true;
      state.exploreTab = "mapping";
      setView("explore");
      return;
    }
    state.selectedClusterId = item.dataset.clusterId;
    state.exploreTab = "trend";
    setView("explore");
  }));
  attachLogoFallbacks($("#sparkle-list"));
  const cluster = selectedCluster();
  const detail = $("#sparkle-detail");
  if (detail && cluster) {
    $("#sparkle-detail-title").textContent = cluster.cluster_name;
    detail.innerHTML = `
      <div class="detail-body">
        <div class="metric-grid">
          ${metric("First-week posts", cluster.current_week_posts)}
          ${metric("Subreddits", cluster.unique_subreddits)}
          ${metric("Spike", spikeLabel(cluster))}
          ${metric("Sentiment", sentimentBadge(cluster.avg_sentiment))}
        </div>
        <div class="signal-section">
          <h4>Fresh keywords</h4>
          <div class="chip-list">${cluster.terms.slice(0, 12).map((term) => `<span class="chip">${term.term}</span>`).join("")}</div>
        </div>
        <div class="signal-section">
          <h4>Brand visuals</h4>
          <div class="brand-visual-grid">
            ${cluster.brands.slice(0, 6).map((brand) => brandImageCard(brand, "visual")).join("") || "<span class='muted'>No brand image candidates</span>"}
          </div>
        </div>
      </div>
    `;
    attachLogoFallbacks(detail);
  }
}

function renderRanking() {
  $("#ranking-chart").innerHTML = state.data.clusters.slice(0, 24).map((cluster) => `
    <button class="bar-row dashboard-select-row" data-cluster-id="${cluster.cluster_id}">
      <span>${cluster.cluster_name}</span>
      <span class="bar-track"><i class="bar-fill" style="--w:${cluster.trend_score_100}%"></i></span>
      <strong>${fmt(cluster.trend_score, 1)}</strong>
    </button>
  `).join("");
  $$("#ranking-chart .dashboard-select-row").forEach((row) => row.addEventListener("click", () => {
    state.selectedClusterId = row.dataset.clusterId;
    renderAll();
  }));
}

function renderDashboardCategoryFilter() {
  const select = $("#dashboard-category-select");
  if (!select) return;
  select.innerHTML = [
    `<option value="all" ${state.dashboardCategoryId === "all" ? "selected" : ""}>Overall / All categories</option>`,
    ...[...state.data.clusters]
      .sort((a, b) => a.cluster_name.localeCompare(b.cluster_name))
      .map((cluster) => `<option value="${cluster.cluster_id}" ${cluster.cluster_id === state.dashboardCategoryId ? "selected" : ""}>${cluster.cluster_name}</option>`),
  ].join("");
}

function renderDimensionCharts() {
  renderDimensionChart("#momentum-chart", "momentum_score", "Momentum", momentumRawDisplay);
  renderDimensionChart("#reach-chart", "cross_community_score", "Reach", reachRawDisplay);
  renderDimensionChart("#sentiment-chart", "sentiment_score", "Sentiment", sentimentRawDisplay);
  renderDimensionChart("#engagement-chart", "engagement_score", "Engagement", engagementRawDisplay);
}

function renderDimensionChart(selector, key, label, valueRenderer) {
  const root = $(selector);
  if (!root) return;
  root.innerHTML = [...state.data.clusters]
    .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))
    .slice(0, 10)
    .map((cluster, index) => {
      const score = Number(cluster[key] || 0);
      return `
        <button class="dimension-row" data-cluster-id="${cluster.cluster_id}" title="${label}">
          <span class="rank-badge">${index + 1}</span>
          <span>${cluster.cluster_name}</span>
          <span class="bar-track"><i class="bar-fill" style="--w:${Math.max(4, score * 20)}%"></i></span>
          <em>${valueRenderer(cluster)}</em>
        </button>
      `;
    }).join("");
  root.querySelectorAll(".dimension-row").forEach((row) => row.addEventListener("click", () => {
    state.selectedClusterId = row.dataset.clusterId;
    renderAll();
  }));
}

function spikeLabel(cluster) {
  if (Number(cluster.previous_week_posts || 0) === 0) return "new";
  return `${fmt(cluster.growth_rate, 1)}x`;
}

function momentumRawDisplay(cluster) {
  return `<span class="raw-value">${cluster.current_week_posts || 0} posts · ${spikeLabel(cluster)} spike</span>`;
}

function engagementRawDisplay(cluster) {
  return `<span class="raw-value">${fmt(cluster.avg_log_engagement, 2)} engagement</span>`;
}

function reachRawDisplay(cluster) {
  return `<span class="raw-value">${cluster.unique_subreddits || 0} subreddits</span>`;
}

function sentimentRawDisplay(cluster) {
  return sentimentBadge(cluster.avg_sentiment);
}

function renderDashboardRawData() {
  const root = $("#dashboard-raw-data");
  if (!root) return;
  const rows = dashboardPosts().slice(0, 12);
  root.innerHTML = `
    <div class="raw-table-head">
      <span>Brand / Signal</span>
      <span>Post</span>
      <span>Subreddit</span>
      <span>Sentiment</span>
      <span>URL</span>
    </div>
    <div class="raw-table-body">
      ${(rows.length ? rows : state.data.posts.slice(0, 12)).map((post) => `
        <div class="raw-table-row">
          <span>${post.brand_display || "Reddit"}</span>
          <span><strong>${post.title || "Untitled Reddit post"}</strong><small>${post.text_snippet || post.context_window || ""}</small></span>
          <span>r/${post.subreddit || "unknown"}</span>
          <span class="${post.sentiment_label || "neutral"}">${post.sentiment_label || "neutral"}</span>
          <span><a href="${post.url}" target="_blank" rel="noreferrer">Open</a></span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderDashboardWordCloud() {
  const root = $("#dashboard-wordcloud");
  if (!root) return;
  const terms = dashboardTerms();
  const cluster = selectedDashboardCluster() || { cluster_id: "all", terms };
  root.innerHTML = terms.map((term) => wordCloudTerm(term, cluster)).join("") || "<span class='muted'>No word cloud data</span>";
  attachEvidenceHandlers(root);
}

function renderDailyTrend() {
  const root = $("#daily-trend");
  if (!root) return;
  const posts = dashboardPosts();
  const days = dailyRows(posts);
  const maxPosts = Math.max(...days.map((day) => day.posts), 1);
  const points = days.map((day, index) => {
    const x = days.length === 1 ? 50 : (index / (days.length - 1)) * 100;
    const y = 82 - ((day.sentiment + 1) / 2) * 64;
    return `${x},${y}`;
  }).join(" ");
  root.innerHTML = `
    <div class="daily-combo">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${points}" fill="none" stroke="var(--cyan)" stroke-width="2.5" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      ${days.map((day) => `
        <div class="daily-bar">
          <span class="daily-bar-fill" style="--h:${Math.max(4, 100 * day.posts / maxPosts)}%"></span>
          <strong>${day.posts}</strong>
          <small>${day.label}</small>
        </div>
      `).join("")}
    </div>
    <div class="chart-note">Bar = daily post count · Line = average sentiment</div>
  `;
}

function dailyRows(posts) {
  const formatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
  const byDay = new Map();
  posts.forEach((post) => {
    const date = new Date(post.published_at);
    if (Number.isNaN(date.getTime())) return;
    const key = date.toISOString().slice(0, 10);
    const current = byDay.get(key) || { label: formatter.format(date), posts: 0, sentimentSum: 0 };
    current.posts += 1;
    current.sentimentSum += Number(post.sentiment_compound || 0);
    byDay.set(key, current);
  });
  const rows = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => ({
    ...row,
    sentiment: row.posts ? row.sentimentSum / row.posts : 0,
  }));
  return rows.length ? rows : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => ({ label, posts: 0, sentiment: 0 }));
}

function renderKeywordSentimentChart() {
  const root = $("#keyword-sentiment-chart");
  if (!root) return;
  const terms = dashboardTerms();
  const maxMentions = Math.max(...terms.map((term) => term.mentions || 0), 1);
  root.innerHTML = `
    <div class="keyword-sentiment-viewport">
    <div class="keyword-sentiment-rows" style="--zoom:1">
      ${terms.slice(0, 18).map((term, index) => {
        const sentiment = term.sentiment >= 0.15 ? "positive" : term.sentiment <= -0.08 ? "negative" : "neutral";
        const axisValue = ((term.mentions || 0) / maxMentions);
        const x = Math.max(6, Math.min(96, axisValue * 92));
        return `
          <div class="keyword-sentiment-row">
            <span>${term.term}</span>
            <span class="keyword-axis-track"><i class="${sentiment}" style="--x:${x}%"></i></span>
            <em class="${sentiment}">${term.mentions || 0} · ${sentimentLabel(sentiment)}</em>
          </div>
        `;
      }).join("")}
    </div>
    </div>
  `;
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-view]");
  if (target) setView(target.dataset.view);
  const exploreTarget = event.target.closest("[data-explore-tab]");
  if (exploreTarget) {
    state.exploreTab = exploreTarget.dataset.exploreTab;
    renderAll();
  }
});

$$(".guide-grid [data-sort-key]").forEach((button) => {
  button.addEventListener("click", () => {
    setSortBy(button.dataset.sortKey);
  });
});

$("#brand-query-input")?.addEventListener("input", (event) => {
  state.brandQuery = event.target.value;
  renderAll();
});

$("#category-filter-input")?.addEventListener("input", (event) => {
  state.categoryFilter = event.target.value;
  renderAll();
});

$("#opportunity-zoom")?.addEventListener("input", (event) => {
  state.opportunityZoom = Number(event.target.value || 1);
  renderAll();
});

$("#opportunity-drag")?.addEventListener("input", (event) => {
  state.opportunityDrag = Number(event.target.value || 0);
  renderAll();
});

$("#only-brand-toggle")?.addEventListener("click", () => {
  state.onlyBrand = !state.onlyBrand;
  renderAll();
});

$("#back-to-category")?.addEventListener("click", () => {
  state.exploreTab = "trend";
  renderAll();
});

$("#dashboard-category-select")?.addEventListener("change", (event) => {
  state.dashboardCategoryId = event.target.value;
  if (event.target.value !== "all") state.selectedClusterId = event.target.value;
  renderAll();
});

$("#sparkle-category-select")?.addEventListener("change", (event) => {
  state.sparkleCategoryId = event.target.value;
  if (event.target.value !== "all") state.selectedClusterId = event.target.value;
  renderAll();
});

$("#export-button")?.addEventListener("click", async () => {
  const css = await fetch("./styles.css").then((response) => response.text()).catch(() => "");
  const activeView = $(".view.active");
  const title = state.view === "dashboard"
    ? `Reddit Trend Radar Dashboard - ${selectedDashboardCluster()?.cluster_name || "All Categories"}`
    : "Reddit Trend Radar Export";
  const html = `<!doctype html>
<html lang="zh-Hans">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>${css}</style>
</head>
<body>
  <div class="app-shell export-shell">
    ${activeView?.outerHTML || ""}
  </div>
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = state.view === "dashboard" ? "reddit-trend-radar-dashboard.html" : "reddit-trend-radar-view.html";
  anchor.click();
  URL.revokeObjectURL(url);
});

loadData().catch((error) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#fff">${error.stack || error}</pre>`;
});
