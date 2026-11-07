import { db } from "../db";
import { enc, esc, html } from "../html";
import { requestContext } from "../prefs";
import type { Kanji } from "../types";
import { keywordText } from "./shared";
import { layout } from "./layout";

type ComponentRow = Pick<Kanji, "literal" | "added" | "unfinished" | "is_component"> & {
  component_group: number | null;
  keyword: string | null;
};
type ComponentUses = { priority: number; other: number };

const tile = (row: ComponentRow, use: ComponentUses) => {
  const state = row.added === 1 ? (row.unfinished === 1 ? "unf" : "in") : "";
  const status = state === "unf" ? "Unfinished" : state === "in" ? "Finished" : "Not added";
  const dot = state
    ? `<i class="sdot ${state}" role="img" aria-label="${status}" title="${status}"></i>`
    : "";
  const keyword = keywordText(row.keyword);
  const total = use.priority + use.other;
  const label = use.other > 0 ? `${use.priority}+${use.other}` : String(use.priority);
  const title = `Used as a component in ${total} kanji: ${use.priority} priority, ${use.other} non-priority`;
  return `<div class="ctile">
    <div class="ctop">
      <input class="cbox" type="checkbox" name="literal" value="${esc(row.literal)}" form="component-group-form" aria-label="Select ${esc(row.literal)}">
      <a class="ckanji" href="/kanji/${enc(row.literal)}" aria-label="Open ${esc(row.literal)}">${esc(row.literal)}${dot}</a>
      <span class="cuses" title="${title}">${label}</span>
    </div>
    ${keyword ? `<span class="ckw" title="${esc(keyword)}">${esc(keyword)}</span>` : ""}
  </div>`;
};

const section = (group: number, rows: ComponentRow[], uses: Map<string, ComponentUses>) => {
  const title = group === 0 ? "Not grouped yet" : `Group ${group}`;
  return `<section class="listsection">
    <div class="levelhead"><div><h2>${esc(title)}</h2><div class="sub">${rows.length} kanji</div></div></div>
    <div class="cgrid">${rows.map((row) => tile(row, uses.get(row.literal) ?? { priority: 0, other: 0 })).join("")}</div>
  </section>`;
};

export function componentsPage() {
  const rows = db.query(`SELECT literal, component_group, is_component, added, unfinished, keyword
    FROM kanjis
    WHERE is_component = 1
    ORDER BY CASE WHEN component_group IS NULL THEN 0 ELSE 1 END, component_group, literal`)
    .all() as ComponentRow[];
  const uses = new Map<string, ComponentUses>();
  for (const { literal, components, low_priority } of db.query(`SELECT literal, components, low_priority FROM kanjis WHERE components IS NOT NULL`).all() as { literal: string; components: string; low_priority: number | null }[]) {
    const tokens = new Set(components.split(/[;、,\s]+/).filter(Boolean));
    for (const token of tokens) {
      if (token === literal) continue;
      const counts = uses.get(token) ?? { priority: 0, other: 0 };
      if (low_priority === 0) counts.priority++;
      else counts.other++;
      uses.set(token, counts);
    }
  }
  const groups = new Map<number, ComponentRow[]>();
  for (const row of rows) {
    const group = Number(row.component_group ?? 0) || 0;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(row);
  }
  const order = [...groups.keys()].sort((a, b) => a === 0 ? -1 : b === 0 ? 1 : a - b);
  const groupNumbers = order.filter((g) => g > 0);
  const sections = order.map((group) => section(group, groups.get(group)!, uses));
  const groupOptions = groupNumbers.map((g) => `<option value="${g}">Group ${g}</option>`).join("");
  const toolbar = `<form id="component-group-form" class="card component-toolbar" method="post" action="/components/group">
    <div class="ctools">
      <label class="cselectall"><input type="checkbox" id="component-select-all"> Select all</label>
      <span class="ccount" id="component-selected-count">0 selected</span>
      <label class="cgroup">Group
        <select name="group" id="component-group">
          <option value="">Choose…</option>
          ${groupOptions}
          <option value="new">New group…</option>
        </select>
      </label>
      <input class="setinput cnewgroup" id="component-new-group" type="number" name="new_group" min="1" step="1" placeholder="New #">
      <button class="pill dark sm" type="submit">Apply</button>
      <button class="pill ghost sm" type="submit" name="action" value="ungroup">Mark ungrouped</button>
    </div>
  </form>`;
  const body = `<div class="listhead"><div><h1>Components</h1><p class="sub">${rows.length} component kanji · ${groupNumbers.length} groups</p></div></div>
    ${rows.length ? toolbar : ""}
    ${sections.length ? `<div class="card listcard">${sections.join("")}</div>` : `<div class="card listempty"><h2>No components yet</h2><p class="sub">Mark a kanji as a component on its edit page.</p></div>`}
    ${rows.length ? `<script src="/js/components.js" defer></script>` : ""}`;
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/components";
  return html(layout("Components – Kanji", body, { theme, back, active: "components" }));
}
