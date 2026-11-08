import { db } from "../db";
import { enc, esc, html, nullsLast } from "../html";
import { requestContext } from "../prefs";
import type { Kanji } from "../types";
import { layout } from "./layout";

type TileRow = Pick<Kanji, "literal" | "added" | "unfinished">;
type ListRow = TileRow & { frequency: number | null; score: number | null; added_at: string | null };

const kanjiTile = (r: TileRow) => {
  const state = r.added === 1 ? (r.unfinished === 1 ? "unf" : "in") : "";
  const status = state === "unf" ? " (unfinished)" : state === "in" ? " (finished)" : " (not added)";
  return `<a class="lkt${state ? ` ${state}` : " notadded"}" href="/kanji/${enc(r.literal)}" aria-label="Open ${esc(r.literal)}${status}">${esc(r.literal)}</a>`;
};

const section = (heading: string, list: TileRow[]) =>
  `<section class="listsection"><div class="listsechead"><h2>${esc(heading)}</h2><span class="sub">${list.length}</span></div><div class="lgrid">${list.map(kanjiTile).join("")}</div></section>`;

const emptyCard = (title: string, message: string) =>
  `<div class="card listempty"><h2>${esc(title)}</h2><p class="sub">${esc(message)}</p><a class="pill dark" href="/">Back to dashboard</a></div>`;

const page = (title: string, body: string, active: string) => {
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/";
  return html(layout(title, body, { theme, back, active }));
};

// every kanji with a level in the given column, grouped by level (easiest first)
export function levelPage(column: "jlpt" | "kanken", label: string, active: string, url: URL) {
  const showRaw = url.searchParams.get("show");
  const filter = showRaw === "finished" || showRaw === "not-added" || showRaw === "unfinished" ? showRaw : "all";
  const rows = db.query(`SELECT literal, ${column} AS lvl, frequency, added, unfinished FROM kanjis WHERE ${column} IS NOT NULL AND ${column} > 0`)
    .all() as (Pick<Kanji, "literal" | "frequency" | "added" | "unfinished"> & { lvl: number })[];
  const levels = new Map<number, typeof rows>();
  for (const r of rows) levels.set(Number(r.lvl), [...(levels.get(Number(r.lvl)) ?? []), r]);
  const finishedTotal = rows.filter((r) => r.added === 1 && r.unfinished !== 1).length;
  const unfinishedTotal = rows.filter((r) => r.added === 1 && r.unfinished === 1).length;
  const notAddedTotal = rows.filter((r) => r.added !== 1).length;
  // JLPT counts down from 5 to 1 and Kanken from 10 to 1, so the highest number is always the easiest level
  const sections = [...levels.keys()].sort((a, b) => b - a).map((lvl) => {
    const list = levels.get(lvl)!.sort((a, b) => nullsLast(a.frequency, b.frequency) || a.literal.localeCompare(b.literal));
    const visible = filter === "all" ? list : list.filter((r) =>
      filter === "finished" ? r.added === 1 && r.unfinished !== 1 :
      filter === "unfinished" ? r.added === 1 && r.unfinished === 1 :
      r.added !== 1,
    );
    if (!visible.length && filter !== "all") return "";
    const finished = list.filter((r) => r.added === 1 && r.unfinished !== 1).length;
    const unfinished = list.filter((r) => r.added === 1 && r.unfinished === 1).length;
    const notAdded = list.length - finished - unfinished;
    const pct = Math.round((finished / list.length) * 100);
    return `<section class="listsection">
      <div class="levelhead"><div><h2>${esc(label)} ${lvl}</h2><div class="sub">${list.length} kanji · ${pct}% finished</div></div><div class="levelcounts"><span class="fin">${finished} finished</span><span class="learn">${unfinished} unfinished</span><span class="miss">${notAdded} not added</span></div></div>
      <div class="levelbar"><i class="fin" style="width:${(finished / list.length) * 100}%"></i><i class="learn" style="width:${(unfinished / list.length) * 100}%"></i></div>
      <div class="lgrid">${visible.map(kanjiTile).join("")}</div>
    </section>`;
  }).filter(Boolean);
  const tab = (id: string, text: string, count: number) => `<a class="tab${filter === id ? " on" : ""}" href="/${active}${id === "all" ? "" : `?show=${id}`}">${text} ${count}</a>`;
  const head = `<div class="listhead left"><div><h1>${esc(label)}</h1><p class="sub">${rows.length} kanji · ${levels.size} levels</p></div>${rows.length ? `<div class="tabs">${tab("all", "All", rows.length)}${tab("finished", "Finished", finishedTotal)}${tab("unfinished", "Unfinished", unfinishedTotal)}${tab("not-added", "Not added", notAddedTotal)}</div>` : ""}</div>`;
  const empty = sections.length
    ? ""
    : emptyCard(
        filter === "finished" ? "No finished kanji" : filter === "not-added" ? "No not added kanji" : filter === "unfinished" ? "No unfinished kanji" : `No ${label} kanji`,
        filter === "all" ? `No kanji have a ${label} level yet.` : `No ${filter === "finished" ? "finished" : filter === "not-added" ? "not added" : "unfinished"} kanji in ${label}.`,
      );
  const body = head + (sections.length ? `<div class="card listcard">${sections.join("")}</div>` : empty);
  return page(`${label} – Kanji`, body, active);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// every added kanji, grouped either by the month it was added (newest first) or by score (lowest first)
export function myListPage(url: URL) {
  const by = url.searchParams.get("by") === "score" ? "score" : "date";
  const rows = db.query(`SELECT literal, added, unfinished, score, added_at, frequency FROM kanjis WHERE COALESCE(added, 0) = 1`)
    .all() as ListRow[];

  const groups = new Map<string, { heading: string; order: number; list: ListRow[] }>();
  const put = (key: string, heading: string, order: number, r: ListRow) => {
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
  const addedAt = (r: ListRow) => String(r.added_at ?? "");
  const sections = [...groups.values()].sort((a, b) => a.order - b.order).map((g) => {
    g.list.sort((a, b) => (by === "date" ? addedAt(b).localeCompare(addedAt(a)) : 0) || nullsLast(a.frequency, b.frequency) || a.literal.localeCompare(b.literal));
    return section(g.heading, g.list);
  });

  const tab = (id: string, text: string) => `<a class="tab${by === id ? " on" : ""}" href="/my-list?by=${id}">${text}</a>`;
  const unfinished = rows.filter((r) => r.unfinished === 1).length;
  const head = `<div class="listhead">
    <div><h1>Your kanji</h1><p class="sub">${rows.length} characters · ${rows.length - unfinished} finished · ${unfinished} unfinished</p></div>
    ${rows.length ? `<div class="tabs">${tab("date", "By date added")}${tab("score", "By score")}</div>` : ""}
  </div>`;
  const body = head + (sections.length ? `<div class="card listcard">${sections.join("")}</div>` : emptyCard("No kanji in your list yet.", "Search for a kanji and add it to start."));
  return page("My list – Kanji", body, "my-list");
}
