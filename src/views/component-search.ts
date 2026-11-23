import { db } from "../db";
import { enc, esc, html, likeEsc } from "../html";
import { requestContext } from "../prefs";
import { keywordText } from "./shared";
import { layout } from "./layout";

type ComponentInfo = { literal: string; keyword: string | null; strokes: number | null; frequency: number | null; is_component?: number | null };
type ResultRow = { literal: string; components: string | null; strokes: number | null; frequency: number | null; added: number | null; unfinished: number | null };
type Match = { row: ResultRow; via: string[] };

const splitComponents = (value: string | null) => new Set(String(value ?? "").split(/[;、,\s]+/).filter(Boolean));

export function parseSelected(value: string | null): string[] {
  return [...new Set(String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
}

const tile = (row: ResultRow, via: string[] = []) => {
  const state = row.added === 1 ? (row.unfinished === 1 ? " unf" : " in") : "";
  const viaText = via.length ? `via ${via[0]}${via.length > 1 ? `+${via.length - 1}` : ""}` : "";
  const viaLabel = via.length ? ` (matched via ${via.join(", ")})` : "";
  return `<a class="lkt${state}${via.length ? " via" : ""}" href="/kanji/${enc(row.literal)}" aria-label="Open ${esc(row.literal)}${esc(viaLabel)}"${via.length ? ` title="Matched via ${esc(via.join(", "))}"` : ""}>${esc(row.literal)}${viaText ? `<span class="lktvia" aria-hidden="true">${esc(viaText)}</span>` : ""}</a>`;
};

export function componentResultsHtml(selected: string[], addedOnly: boolean, includeSubcomponents = false): string {
  const scope = selected.length === 1 ? "this component" : "all selected components";
  if (!selected.length) {
    return `<div class="card component-results-empty"><div class="sub">Choose a component keyword above to find kanji that contain it.</div></div>`;
  }
  const rows = db.query(`SELECT literal, components, strokes, frequency, added, unfinished FROM kanjis`).all() as ResultRow[];
  const selectedSet = new Set(selected);
  const partsByLiteral = new Map<string, Set<string>>();
  for (const row of rows) partsByLiteral.set(row.literal, splitComponents(row.components));

  // One level only: for every component, remember the literals that list it
  // directly. A row matches when each selected component is either one of its
  // own components or a component of one of those direct components.
  const parents = new Map<string, Set<string>>();
  if (includeSubcomponents) {
    for (const row of rows) {
      for (const part of partsByLiteral.get(row.literal)!) {
        const list = parents.get(part);
        if (list) list.add(row.literal);
        else parents.set(part, new Set([row.literal]));
      }
    }
  }

  const matched: Match[] = [];
  for (const row of rows) {
    if (selectedSet.has(row.literal)) continue;
    if (addedOnly && row.added !== 1) continue;
    const parts = partsByLiteral.get(row.literal)!;
    const via = new Set<string>();
    let ok = true;
    for (const component of selected) {
      if (parts.has(component)) continue;
      if (!includeSubcomponents) { ok = false; break; }
      const containers = parents.get(component);
      let found = false;
      if (containers) {
        for (const part of parts) {
          if (containers.has(part)) {
            via.add(part);
            found = true;
            break;
          }
        }
      }
      if (!found) { ok = false; break; }
    }
    if (ok) matched.push({ row, via: [...via] });
  }

  matched.sort((a, b) =>
    Number(a.row.strokes === null) - Number(b.row.strokes === null) ||
    (a.row.strokes ?? 0) - (b.row.strokes ?? 0) ||
    Number(a.row.frequency === null) - Number(b.row.frequency === null) ||
    (a.row.frequency ?? 0) - (b.row.frequency ?? 0) ||
    a.row.literal.localeCompare(b.row.literal));
  const groups = new Map<number | null, Match[]>();
  for (const match of matched) {
    if (!groups.has(match.row.strokes)) groups.set(match.row.strokes, []);
    groups.get(match.row.strokes)!.push(match);
  }
  const resultGroups = [...groups.entries()]
    .sort(([a], [b]) => a === null ? 1 : b === null ? -1 : a - b)
    .map(([strokes, list]) => `<section class="listsection">
      <div class="levelhead"><div><h2>${strokes === null ? "Unknown strokes" : `${strokes} stroke${strokes === 1 ? "" : "s"}`}</h2><div class="sub">${list.length} kanji</div></div></div>
      <div class="lgrid">${list.map((match) => tile(match.row, match.via)).join("")}</div>
    </section>`).join("");
  const indirect = matched.filter((match) => match.via.length > 0).length;
  const note = indirect
    ? `containing ${scope} · ${indirect} matched via a subcomponent`
    : `containing ${scope}`;
  return `<div class="component-results-head"><h2>${matched.length} kanji</h2><span class="sub">${note}</span></div>
    ${resultGroups || `<div class="card component-results-empty"><div class="sub">No kanji contain ${scope}${includeSubcomponents ? ", even one level deeper" : ""}.</div></div>`}`;
}

export function suggestionHtml(query: string, selected: string[]): string {
  const q = query.trim();
  if (q.length < 3) return "";
  const placeholders = selected.map(() => "?").join(",");
  const rows = db.query(`SELECT literal, keyword, strokes, frequency, is_component
    FROM kanjis
    WHERE keyword LIKE ? ESCAPE '\\'${selected.length ? ` AND literal NOT IN (${placeholders})` : ""}
    ORDER BY COALESCE(is_component, 0) DESC, frequency IS NULL, frequency, literal`)
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
  const includeSubcomponents = url.searchParams.get("sub") === "1";
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
  const state = JSON.stringify({ selected: selectedState, addedOnly, includeSubcomponents }).replace(/</g, "\\u003c");
  const body = `<div class="listhead"><div><h1>Find by components</h1><p class="sub">Type a component keyword, choose a match, and narrow the kanji by adding more components.</p></div></div>
    <div class="card component-search-card">
      <label class="component-search-label" for="component-query">Component keyword</label>
      <input id="component-query" class="component-search-input" type="search" placeholder="Type at least 3 characters…" autocomplete="off" spellcheck="false">
      <div id="component-suggestions" class="component-suggestions" aria-live="polite"></div>
      <div class="component-selected-head"><span>Selected components</span>${selected.length ? `<span class="sub">${selected.length}</span>` : ""}</div>
      <div id="component-selected" class="component-selected">${pills || `<span class="sub">None yet.</span>`}</div>
      <div class="component-toggles">
        <label class="component-added-filter"><input id="component-added-only" type="checkbox"${addedOnly ? " checked" : ""}> Added only</label>
        <label class="component-added-filter" title="Also match kanji where a selected component is part of one of its direct components."><input id="component-subcomponents" type="checkbox"${includeSubcomponents ? " checked" : ""}> Include subcomponents (one level)</label>
      </div>
    </div>
    <div id="component-results" class="component-results">${componentResultsHtml(selected, addedOnly, includeSubcomponents)}</div>
    <script type="application/json" id="component-search-state">${state}</script>
    <script src="/js/component-search.js" defer></script>`;
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/components/search";
  return html(layout("Find by components – Kanji", body, { theme, back, active: "components-search" }));
}
