const input = document.getElementById("component-query");
const suggestions = document.getElementById("component-suggestions");
const selectedEl = document.getElementById("component-selected");
const resultsEl = document.getElementById("component-results");
const addedOnly = document.getElementById("component-added-only");

const state = JSON.parse(document.getElementById("component-search-state")?.textContent || '{"selected":[],"addedOnly":false}');
let selected = Array.isArray(state.selected) ? state.selected : [];
let suggestionAbort = null;
let resultsAbort = null;
let suggestTimer = 0;

const queryString = () => {
  const params = new URLSearchParams();
  if (selected.length) params.set("components", selected.map((item) => item.literal).join(","));
  if (addedOnly?.checked) params.set("added", "1");
  return params.toString();
};

const updateUrl = () => {
  const qs = queryString();
  history.replaceState(null, "", `/components/search${qs ? `?${qs}` : ""}`);
};

const renderSelected = () => {
  if (!selectedEl) return;
  selectedEl.innerHTML = selected.length
    ? selected.map((item) => `<span class="selected-component" data-literal="${escapeHtml(item.literal)}">
        <b>${escapeHtml(item.literal)}</b><span>${escapeHtml(item.keyword || "")}</span>
        <button type="button" class="selected-remove" data-remove="${escapeHtml(item.literal)}" aria-label="Remove ${escapeHtml(item.literal)}">×</button>
      </span>`).join("")
    : `<span class="sub">None yet.</span>`;
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

const refreshResults = async () => {
  if (!resultsEl) return;
  if (resultsAbort) resultsAbort.abort();
  const controller = new AbortController();
  resultsAbort = controller;
  const qs = queryString();
  try {
    const response = await fetch(`/components/search/results${qs ? `?${qs}` : ""}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    resultsEl.innerHTML = await response.text();
  } catch (error) {
    if (error.name !== "AbortError") resultsEl.innerHTML = `<div class="card component-results-empty"><div class="sub">Could not update results.</div></div>`;
  }
};

const addComponent = (literal, keyword) => {
  if (!literal || selected.some((item) => item.literal === literal)) return;
  selected.push({ literal, keyword });
  if (input) input.value = "";
  if (suggestions) suggestions.innerHTML = "";
  renderSelected();
  updateUrl();
  refreshResults();
  input?.focus();
};

const removeComponent = (literal) => {
  selected = selected.filter((item) => item.literal !== literal);
  renderSelected();
  updateUrl();
  refreshResults();
};

input?.addEventListener("input", () => {
  window.clearTimeout(suggestTimer);
  const q = input.value.trim();
  if (q.length < 3) {
    if (suggestions) suggestions.innerHTML = "";
    return;
  }
  suggestTimer = window.setTimeout(async () => {
    if (suggestionAbort) suggestionAbort.abort();
    const controller = new AbortController();
    suggestionAbort = controller;
    const params = new URLSearchParams({ q });
    if (selected.length) params.set("components", selected.map((item) => item.literal).join(","));
    try {
      const response = await fetch(`/components/search/suggest?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (suggestions) suggestions.innerHTML = await response.text();
    } catch (error) {
      if (error.name !== "AbortError" && suggestions) suggestions.innerHTML = `<div class="sub component-suggestion-empty">Could not load suggestions.</div>`;
    }
  }, 120);
});

suggestions?.addEventListener("click", (event) => {
  const button = event.target.closest(".component-suggestion");
  if (!button) return;
  addComponent(button.dataset.literal || "", button.dataset.keyword || "");
});

selectedEl?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (button) removeComponent(button.dataset.remove || "");
});

addedOnly?.addEventListener("change", () => {
  updateUrl();
  refreshResults();
});

renderSelected();
