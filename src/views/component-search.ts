import { db } from "../db";
import { enc, esc, html, likeEsc } from "../html";
import { requestContext } from "../prefs";
import { keywordText } from "./shared";
import { layout } from "./layout";

type ComponentInfo = { literal: string; keyword: string | null; strokes: number | null; frequency: number | null };
type ResultRow = { literal: string; components: string | null; strokes: number | null; frequency: number | null; added: number | null };

const splitComponents = (value: string | null) => new Set(String(value ?? "").split(/[;、,\s]+/).filter(Boolean));

export function parseSelected(value: string | null): string[] {
  return [...new Set(String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
}

const tile = (literal: string) =>
  `<a class="lkt" href="/kanji/${enc(literal)}" aria-label="Open ${esc(literal)}">${esc(literal)}</a>`;

export function componentResultsHtml(selected: string[], addedOnly: boolean): string {
  if (!selected.length) {
    return `<div class="card component-results-empty"><div class="sub">Choose a component keyword above to find kanji that contain it.</div></div>`;
  }
  const rows = db.query(`SELECT literal, components, strokes, frequency, added FROM kanjis`).all() as ResultRow[];
  const selectedSet = new Set(selected);
  const matched = rows.filter((row) => {
    if (selectedSet.has(row.literal)) return false;
    if (addedOnly && row.added !== 1) return false;
    const parts = splitComponents(row.components);
    return selected.every((component) => parts.has(component));
  });
  matched.sort((a, b) =>
    Number(a.strokes === null) - Number(b.strokes === null) ||
    (a.strokes ?? 0) - (b.strokes ?? 0) ||
    Number(a.frequency === null) - Number(b.frequency === null) ||
    (a.frequency ?? 0) - (b.frequency ?? 0) ||
    a.literal.localeCompare(b.literal));
  const groups = new Map<number | null, ResultRow[]>();
  for (const row of matched) {
    if (!groups.has(row.strokes)) groups.set(row.strokes, []);
    groups.get(row.strokes)!.push(row);
  }
  const resultGroups = [...groups.entries()]
    .sort(([a], [b]) => a === null ? 1 : b === null ? -1 : a - b)
    .map(([strokes, list]) => `<section class="listsection">
      <div class="levelhead"><div><h2>${strokes === null ? "Unknown strokes" : `${strokes} stroke${strokes === 1 ? "" : "s"}`}</h2><div class="sub">${list.length} kanji</div></div></div>
      <div class="lgrid">${list.map((row) => tile(row.literal)).join("")}</div>
    </section>`).join("");
  return `<div class="component-results-head"><h2>${matched.length} kanji</h2><span class="sub">${selected.length === 1 ? "containing this component" : "containing all selected components"}</span></div>
    ${resultGroups || `<div class="card component-results-empty"><div class="sub">No kanji contain all selected components.</div></div>`}`;
}

export function suggestionHtml(query: string, selected: string[]): string {
  const q = query.trim();
  if (q.length < 3) return "";
  const placeholders = selected.map(() => "?").join(",");
  const rows = db.query(`SELECT literal, keyword, strokes, frequency
    FROM kanjis
    WHERE keyword LIKE ? ESCAPE '\\'${selected.length ? ` AND literal NOT IN (${placeholders})` : ""}
    ORDER BY frequency IS NULL, frequency, literal`)
    .all(`%${likeEsc(q)}%`, ...selected) as ComponentInfo[];
  if (!rows.length) return `<div class="sub component-suggestion-empty">No keywords match “${esc(q)}”.</div>`;
  return rows.map((row) => `<button class="component-suggestion" type="button" data-literal="${esc(row.literal)}" data-keyword="${esc(keywordText(row.keyword))}">
    <b>${esc(row.literal)}</b>
    <span>${esc(keywordText(row.keyword))}</span>
  </button>`).join("");
}

export function componentSearchPage(url: URL) {
  const selected = parseSelected(url.searchParams.get("components"));
  const addedOnly = url.searchParams.get("added") === "1";
  const info = selected.length
    ? db.query(`SELECT literal, keyword, strokes, frequency FROM kanjis WHERE literal IN (${selected.map(() => "?").join(",")})`).all(...selected) as ComponentInfo[]
    : [];
  const byLiteral = new Map(info.map((row) => [row.literal, row]));
  const selectedState = selected.map((literal) => {
    const row = byLiteral.get(literal);
    return { literal, keyword: keywordText(row?.keyword ?? null) };
  });
  const pills = selectedState.map((row) => `<span class="selected-component" data-literal="${esc(row.literal)}">
    <b>${esc(row.literal)}</b><span>${esc(row.keyword)}</span>
    <button type="button" class="selected-remove" data-remove="${esc(row.literal)}" aria-label="Remove ${esc(row.literal)}">×</button>
  </span>`).join("");
  const state = JSON.stringify({ selected: selectedState, addedOnly }).replace(/</g, "\\u003c");
  const body = `<div class="listhead"><div><h1>Find by components</h1><p class="sub">Type a component keyword, choose a match, and narrow the kanji by adding more components.</p></div></div>
    <div class="card component-search-card">
      <label class="component-search-label" for="component-query">Component keyword</label>
      <input id="component-query" class="component-search-input" type="search" placeholder="Type at least 3 characters…" autocomplete="off" spellcheck="false">
      <div id="component-suggestions" class="component-suggestions" aria-live="polite"></div>
      <div class="component-selected-head"><span>Selected components</span>${selected.length ? `<span class="sub">${selected.length}</span>` : ""}</div>
      <div id="component-selected" class="component-selected">${pills || `<span class="sub">None yet.</span>`}</div>
      <label class="component-added-filter"><input id="component-added-only" type="checkbox"${addedOnly ? " checked" : ""}> Added only</label>
    </div>
    <div id="component-results" class="component-results">${componentResultsHtml(selected, addedOnly)}</div>
    <script type="application/json" id="component-search-state">${state}</script>
    <script src="/js/component-search.js" defer></script>`;
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/components/search";
  return html(layout("Find by components – Kanji", body, { theme, back, active: "components-search" }));
}
