import { db } from "../db";
import { enc, esc, html, nullsLast } from "../html";
import type { Kanji } from "../types";
import { layout } from "./layout";

// one plain character tile linking to the kanji page; green when added, red when added but unfinished, no marking otherwise
const kanjiTile = (r: Pick<Kanji, "literal" | "added" | "unfinished">) => {
  const state = r.added === 1 ? (r.unfinished === 1 ? "unfinished" : "added") : "";
  const status = state === "unfinished" ? " (unfinished)" : state === "added" ? " (in your study list)" : "";
  return `<a class="kt k${state ? ` ${state}` : ""}" href="/kanji/${enc(r.literal)}" aria-label="Open ${esc(r.literal)}${status}">${esc(r.literal)}</a>`;
};
const countLabel = (n: number) => `<span class="cnt">(${n} ${n === 1 ? "character" : "characters"})</span>`;

// every kanji with a level in the given column, grouped by level (easiest first), shown as plain characters coloured by study state
export function levelPage(column: "jlpt" | "kanken", label: string, active: string) {
  const rows = db.query(`SELECT literal, ${column} AS lvl, frequency, added, unfinished FROM kanjis WHERE ${column} IS NOT NULL AND ${column} > 0`)
    .all() as (Pick<Kanji, "literal" | "frequency" | "added" | "unfinished"> & { lvl: number })[];
  const levels = new Map<number, typeof rows>();
  for (const r of rows) levels.set(Number(r.lvl), [...(levels.get(Number(r.lvl)) ?? []), r]);
  // JLPT counts down from 5 to 1 and Kanken from 10 to 1, so the highest number is always the easiest level
  const sections = [...levels.keys()].sort((a, b) => b - a).map((lvl) => {
    const list = levels.get(lvl)!.sort((a, b) => nullsLast(a.frequency, b.frequency) || a.literal.localeCompare(b.literal));
    const tiles = list.map(kanjiTile).join("");
    return `<section><h2>${label} ${lvl}${countLabel(list.length)}</h2><div class="kgrid">${tiles}</div></section>`;
  });
  return html(layout(`${label} – Kanji`, "", `<h1>${label}</h1>` + (sections.join("") || `<div class="box empty">No kanji have a ${label} level.</div>`), active));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// every added kanji, grouped either by the month it was added (newest first) or by score (lowest first)
export function myListPage(url: URL) {
  const by = url.searchParams.get("by") === "score" ? "score" : "date";
  const rows = db.query(`SELECT literal, added, unfinished, score, added_at, frequency FROM kanjis WHERE COALESCE(added, 0) = 1`)
    .all() as (Pick<Kanji, "literal" | "added" | "unfinished" | "frequency"> & { score: number | null; added_at: string | null })[];

  // group key -> { heading, sort position, kanji }; kanji without a date/score go in a last group
  const groups = new Map<string, { heading: string; order: number; list: typeof rows }>();
  const put = (key: string, heading: string, order: number, r: (typeof rows)[number]) => {
    const g = groups.get(key) ?? { heading, order, list: [] };
    g.list.push(r);
    groups.set(key, g);
  };
  for (const r of rows) {
    if (by === "date") {
      const m = /^(\d{4})-(\d{2})/.exec(String(r.added_at ?? ""));
      if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) put(`${m[1]}-${m[2]}`, `${MONTHS[Number(m[2]) - 1]} ${m[1]}`, -(Number(m[1]) * 12 + Number(m[2])), r);
      else put("none", "No date", Infinity, r);
    } else if (r.score === null || r.score === undefined) put("none", "No score", Infinity, r);
    else put(`s${r.score}`, `Score ${r.score}`, Number(r.score), r);
  }
  const addedAt = (r: (typeof rows)[number]) => String(r.added_at ?? "");
  const sections = [...groups.values()].sort((a, b) => a.order - b.order).map((g) => {
    g.list.sort((a, b) => (by === "date" ? addedAt(b).localeCompare(addedAt(a)) : 0) || nullsLast(a.frequency, b.frequency) || a.literal.localeCompare(b.literal));
    return `<section><h2>${esc(g.heading)}${countLabel(g.list.length)}</h2><div class="kgrid">${g.list.map(kanjiTile).join("")}</div></section>`;
  });
  const pill = (id: string, text: string) => `<a class="pill${by === id ? " on" : ""}" href="/my-list?by=${id}">${text}</a>`;
  const unfinishedCount = rows.filter((r) => r.unfinished === 1).length;
  const summary = rows.length
    ? `<p class="summary"><b class="fin">${rows.length - unfinishedCount}</b> finished, <b class="unfin">${unfinishedCount}</b> unfinished</p>`
    : "";
  const body = `<h1>MY LIST (${rows.length})</h1>${summary}<div class="pills">${pill("date", "By date added")}${pill("score", "By score")}</div>`
    + (sections.join("") || `<div class="box empty">No kanji in your list yet.</div>`);
  return html(layout("My list – Kanji", "", body, "my-list"));
}
