const state = {
  data: null,
  view: "home",
  exploreTab: "trend",
  selectedClusterId: null,
  sortBy: "trend_score",
  search: "",
  brandQuery: "",
  categoryFilter: "",
  onlyBrand: false,
  selectedSignalKey: "",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const fmt = (value, digits = 1) => Number(value || 0).toFixed(digits);
const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const scoreLabel = {
  trend_score: "Overall",
  momentum_score: "Momentum",
  sentiment_score: "Sentiment",
  cross_community_score: "Range",
  engagement_score: "Engagement",
};

async function loadData() {
  const response = await fetch("./public/data/dashboard.json", { cache: "no-store" });
  state.data = await response.json();
  state.selectedClusterId = state.data.clusters[0]?.cluster_id || null;
  hydratePeriod();
  hydrateCategoryFilter();
  renderAll();
  drawHeroCanvas();
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
  const query = state.search.trim().toLowerCase();
  const items = [...state.data.clusters].filter((cluster) => {
    if (!query) return true;
    const haystack = [
      cluster.cluster_name,
      ...cluster.terms.map((term) => term.term),
      ...cluster.brands.map((brand) => brand.brand_display),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
  return items.sort((a, b) => Number(b[state.sortBy] || 0) - Number(a[state.sortBy] || 0));
}

function renderAll() {
  if (!state.data) return;
  renderHeroStats();
  setExploreTab(state.exploreTab);
  renderClusterList();
  renderClusterDetail();
  renderScatter();
  renderOpportunityLists();
  renderKeywordMap();
  renderSparkle();
  renderRanking();
  renderDistribution();
  renderBrands();
  renderPosts();
}

function renderHeroStats() {
  const meta = state.data.meta;
  const stats = [
    ["Analysis Week", meta.latest_week],
    ["Reddit Posts", meta.post_count.toLocaleString()],
    ["Trend Clusters", meta.cluster_count],
    ["Brand Signals", meta.brand_signal_count.toLocaleString()],
    ["Avg Trend Score", fmt(meta.avg_trend_score, 2)],
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

function renderClusterDetail() {
  const cluster = selectedCluster();
  if (!cluster) return;
  const posts = clusterPosts(cluster.cluster_id);
  $("#detail-title").textContent = cluster.cluster_name;
  $("#cluster-detail").innerHTML = `
    <div class="detail-body">
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
  const termItems = cluster.terms.map((term) => ({ ...term, kind: "keyword", display: term.term, url: `https://www.google.com/search?q=${encodeURIComponent(`${term.term} product`)}` }));
  return [...brandItems, ...termItems].sort((a, b) => Number(b.mentions || 0) - Number(a.mentions || 0)).slice(0, 18);
}

function productSignalCard(item, cluster) {
  const sentiment = item.sentiment >= 0.15 ? "positive" : item.sentiment <= -0.08 ? "negative" : "neutral";
  const tag = item.kind === "brand" ? brandTag(item.brand_signal_type) : item.entity_type?.replaceAll("_", " ");
  const initials = item.kind === "brand" ? clusterInitials(item.display) : "#";
  const googleUrl = item.kind === "brand" ? (item.url || brandImageSearchUrl({ brand_display: item.display })) : item.url;
  return `
    <article class="product-signal-card ${item.kind}">
      <span class="product-logo">${initials}</span>
      <div class="product-card-main">
        <strong>${item.display}</strong>
        <small>${tag || item.kind} · <span class="${sentiment}">${sentiment}</span> · ${item.mentions || 0} mentions</small>
      </div>
      <div class="signal-card-actions">
        <a href="${googleUrl}" target="_blank" rel="noreferrer">Google</a>
        <button type="button" data-evidence-cluster="${cluster.cluster_id}">Evidence</button>
      </div>
    </article>
  `;
}

function attachEvidenceHandlers(root) {
  root.querySelectorAll("[data-evidence-cluster]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      state.selectedClusterId = event.currentTarget.dataset.evidenceCluster;
      setView("dashboard");
    });
  });
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function starMetric(label, value) {
  const score = Math.max(0, Math.min(5, Number(value || 0)));
  const full = Math.round(score);
  const stars = Array.from({ length: 5 }, (_, i) => `<span class="${i < full ? "on" : ""}">★</span>`).join("");
  return `<div class="star-metric"><span>${label}</span><strong>${stars}</strong><em>${fmt(score, 1)}</em></div>`;
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
  if (type.includes("whitelist")) return "whitelist";
  if (type.includes("catalog")) return "known";
  if (type.includes("candidate")) return "candidate";
  return type.replaceAll("_", " ");
}

function renderScatter() {
  const maxPosts = Math.max(...state.data.clusters.map((cluster) => cluster.current_week_posts), 1);
  $("#opportunity-scatter").innerHTML = `
    <span class="axis-label axis-top">High momentum</span>
    <span class="axis-label axis-right">Broad reach</span>
    <span class="axis-label axis-bottom">Niche / early</span>
    <span class="axis-label axis-left">Low reach</span>
    ${state.data.clusters.slice(0, 40).map((cluster) => {
    const x = Math.min(92, Math.max(8, cluster.cross_community_score * 18));
    const y = Math.min(92, Math.max(8, cluster.momentum_score * 18));
    const size = 8 + 22 * (cluster.current_week_posts / maxPosts);
    const color = cluster.sentiment_score >= 4 ? "rgba(45, 229, 141, 0.86)" : cluster.sentiment_score >= 3 ? "rgba(20, 241, 255, 0.78)" : "rgba(255, 63, 143, 0.78)";
    return `<button class="scatter-dot" title="${cluster.cluster_name}" style="--x:${x}%;--y:${y}%;--size:${size}px;--color:${color}" data-cluster-id="${cluster.cluster_id}"></button>`;
  }).join("")}`;
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
    state.selectedClusterId = item.dataset.clusterId;
    state.exploreTab = "trend";
    renderAll();
  }));
}

function opportunityRow(cluster, index) {
  return `
    <button class="opportunity-item" data-cluster-id="${cluster.cluster_id}">
      <span class="rank-badge">${String(index + 1).padStart(2, "0")}</span>
      <span>
        <strong>${cluster.cluster_name}</strong>
        <small>Momentum ${fmt(cluster.momentum_score, 1)} · Range ${fmt(cluster.cross_community_score, 1)} · ${cluster.current_week_posts} posts</small>
      </span>
      <span class="score-pill">${fmt(cluster.trend_score, 1)}</span>
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
      ${cards.map((item) => termCard(item)).join("") || "<div class='empty-state'>No matching keyword or brand signals.</div>"}
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
  return [...keywords, ...brands]
    .filter((item) => !selectedCategory || item.cluster_name.toLowerCase() === selectedCategory)
    .filter((item) => !state.onlyBrand || item.kind === "brand")
    .filter((item) => !brandQuery || (item.kind === "brand" && item.display.toLowerCase().includes(brandQuery)))
    .sort((a, b) => Number(b.mentions || 0) - Number(a.mentions || 0))
    .slice(0, 80);
}

function signalKey(item) {
  return `${item.kind}:${item.cluster_id}:${item.display}`;
}

function termCard(item) {
  const sentiment = item.sentiment >= 0.15 ? "positive" : item.sentiment <= -0.08 ? "negative" : "neutral";
  const tag = item.kind === "brand" ? brandTag(item.brand_signal_type) : item.entity_type?.replaceAll("_", " ");
  const url = item.kind === "brand" && item.url ? `<a href="${item.url}" target="_blank" rel="noreferrer">Google</a>` : "<span>Category</span>";
  return `
    <button class="term-card ${item.kind} ${signalKey(item) === state.selectedSignalKey ? "active" : ""}" data-cluster-id="${item.cluster_id}" data-signal-key="${signalKey(item)}">
      <span class="term-kind">${item.kind === "brand" ? "Brand" : "Keyword"}</span>
      <strong>${item.display}</strong>
      <small>${item.cluster_name}</small>
      <div class="term-meta">
        <span class="tag">${tag}</span>
        <span class="sentiment-badge ${sentiment}">${sentiment}</span>
        <span>${item.mentions} mentions</span>
        ${url}
      </div>
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
  const tag = item.kind === "brand" ? brandTag(item.brand_signal_type) : item.entity_type?.replaceAll("_", " ");
  const cluster = state.data.clusters.find((row) => row.cluster_id === item.cluster_id);
  $("#signal-detail-title").textContent = item.display;
  detail.innerHTML = `
    <div class="detail-body">
      <div class="signal-hero ${item.kind}">
        <span>${item.kind === "brand" ? clusterInitials(item.display) : "#"}</span>
        <div>
          <strong>${item.display}</strong>
          <small>${item.kind === "brand" ? "Brand signal" : "Keyword / product phrase"}</small>
        </div>
      </div>
      <div class="metric-grid two">
        ${metric("Frequency", `${item.mentions} mentions`)}
        ${metric("Sentiment", sentiment)}
        ${metric("Category", item.cluster_name)}
        ${metric("Tag", tag)}
      </div>
      <div class="signal-section">
        <h4>Related category context</h4>
        <div class="chip-list">
          ${(cluster?.terms || []).slice(0, 10).map((term) => `<span class="chip">${term.term} · ${term.mentions}</span>`).join("") || "<span class='muted'>No related terms</span>"}
        </div>
      </div>
      <div class="signal-section">
        ${item.kind === "brand" && item.url ? `<a class="primary-link" href="${item.url}" target="_blank" rel="noreferrer">Open brand search ↗</a>` : `<button class="primary-link" data-cluster-id="${item.cluster_id}" type="button">Open category detail</button>`}
      </div>
    </div>
  `;
  detail.querySelector("[data-cluster-id]")?.addEventListener("click", (event) => {
    state.selectedClusterId = event.currentTarget.dataset.clusterId;
    state.exploreTab = "trend";
    renderAll();
  });
}

function renderSparkle() {
  $("#sparkle-list").innerHTML = state.data.clusters
    .filter((cluster) => cluster.previous_week_posts === 0)
    .sort((a, b) => b.current_week_posts - a.current_week_posts)
    .slice(0, 12)
    .map((cluster) => `
      <button class="sparkle-item" data-cluster-id="${cluster.cluster_id}">
        <span class="new-pill">NEW</span>
        <span><strong>${cluster.cluster_name}</strong><br><span class="muted">${cluster.current_week_posts} posts · ${cluster.unique_subreddits} subreddits</span></span>
        <span class="score-pill">${fmt(cluster.trend_score, 1)}</span>
      </button>
    `).join("");
  $$(".sparkle-item").forEach((item) => item.addEventListener("click", () => {
    state.selectedClusterId = item.dataset.clusterId;
    state.exploreTab = "trend";
    setView("explore");
  }));
  const cluster = selectedCluster();
  const detail = $("#sparkle-detail");
  if (detail && cluster) {
    $("#sparkle-detail-title").textContent = cluster.cluster_name;
    detail.innerHTML = `
      <div class="detail-body">
        <div class="metric-grid">
          ${metric("First-week posts", cluster.current_week_posts)}
          ${metric("Subreddits", cluster.unique_subreddits)}
          ${metric("Trend", fmt(cluster.trend_score, 2))}
          ${metric("Sentiment", fmt(cluster.sentiment_score, 2))}
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
    <div class="bar-row">
      <span>${cluster.cluster_name}</span>
      <span class="bar-track"><i class="bar-fill" style="--w:${cluster.trend_score_100}%"></i></span>
      <strong>${fmt(cluster.trend_score, 1)}</strong>
    </div>
  `).join("");
}

function renderDistribution() {
  const maxCount = Math.max(...state.data.trend_distribution.map((row) => row.count), 1);
  $("#distribution-chart").innerHTML = state.data.trend_distribution.map((row) => `
    <div class="dist-bar">
      <i style="--h:${Math.max(5, 100 * row.count / maxCount)}%"></i>
      <strong>${row.count}</strong>
      <span>${row.band}</span>
    </div>
  `).join("");
}

function renderBrands() {
  $("#brand-table").innerHTML = state.data.brands.slice(0, 18).map((brand) => `
    <div class="brand-item">
      <div class="brand-line"><strong>${brand.brand_display}</strong><span class="score-pill">${brand.mentions}</span></div>
      <div class="brand-line muted"><span>${brand.cluster_name}</span><span>${brand.brand_signal_type.replaceAll("_", " ")}</span></div>
    </div>
  `).join("");
}

function renderPosts() {
  const cluster = selectedCluster();
  const posts = state.data.posts.filter((post) => post.cluster_id === cluster?.cluster_id).slice(0, 14);
  $("#post-stream").innerHTML = (posts.length ? posts : state.data.posts.slice(0, 14)).map((post) => `
    <article class="post-item">
      <div class="post-line"><strong>${post.title}</strong><span class="muted">r/${post.subreddit}</span></div>
      <p class="muted">${post.context_window || post.text_snippet}</p>
      <div class="post-line"><span>${post.brand_display} · ${post.sentiment_label}</span><a href="${post.url}" target="_blank" rel="noreferrer">Open</a></div>
    </article>
  `).join("");
}

function drawHeroCanvas() {
  const canvas = $("#hero-canvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);
  let t = 0;
  const points = Array.from({ length: 110 }, (_, i) => ({
    a: (i / 110) * Math.PI * 2,
    r: 110 + 240 * ((i * 37) % 100) / 100,
    s: 0.4 + ((i * 17) % 10) / 10,
  }));
  function frame() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    const cx = w * 0.74;
    const cy = h * 0.45;
    ctx.strokeStyle = "rgba(20, 241, 255, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 180 + i * 9, 62 + i * 4, -0.35 + t * 0.0002, 0, Math.PI * 2);
      ctx.stroke();
    }
    points.forEach((p, i) => {
      const x = cx + Math.cos(p.a + t * 0.001 * p.s) * p.r;
      const y = cy + Math.sin(p.a + t * 0.001 * p.s) * p.r * 0.36;
      ctx.fillStyle = i % 5 === 0 ? "rgba(255, 63, 143, 0.7)" : "rgba(20, 241, 255, 0.55)";
      ctx.beginPath();
      ctx.arc(x, y, i % 7 === 0 ? 2.2 : 1.2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = "rgba(255, 63, 143, 0.22)";
    ctx.beginPath();
    ctx.moveTo(w * 0.04, h * 0.62);
    ctx.bezierCurveTo(w * 0.22, h * 0.48, w * 0.34, h * 0.68, w * 0.5, h * 0.36);
    ctx.stroke();
    t += 16;
    requestAnimationFrame(frame);
  }
  frame();
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

$("#sort-select")?.addEventListener("change", (event) => {
  state.sortBy = event.target.value;
  renderAll();
});

$("#search-input")?.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderAll();
});

$("#brand-query-input")?.addEventListener("input", (event) => {
  state.brandQuery = event.target.value;
  renderAll();
});

$("#category-filter-input")?.addEventListener("input", (event) => {
  state.categoryFilter = event.target.value;
  renderAll();
});

$("#only-brand-toggle")?.addEventListener("click", () => {
  state.onlyBrand = !state.onlyBrand;
  renderAll();
});

$("#export-button")?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "reddit-trend-radar-dashboard.json";
  anchor.click();
  URL.revokeObjectURL(url);
});

loadData().catch((error) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#fff">${error.stack || error}</pre>`;
});
