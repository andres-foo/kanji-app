import { db, totalKnown } from "../db";
import { enc, esc, html, likeEsc } from "../html";
import { findImage } from "../images";
import { MAX_SCORE, MIN_SCORE, masteryFor } from "../mastery";
import { requestContext } from "../prefs";
import { storyHtml } from "../story";
import type { Kanji, Word } from "../types";
import { jlptPriority, kankenPriority, keywordText, meaningsText, readingList, splitKanjiMarker, type Priority } from "./shared";
import { messagePage } from "./message";
import { layout } from "./layout";
import { readFile } from "node:fs/promises";

const strokeOrderSvg = async (literal: string) => {
  const chars = [...literal.trim()];
  if (chars.length !== 1) return null;
  const key = chars[0].codePointAt(0)!.toString(16).padStart(5, "0");
  let raw: string;
  try {
    raw = await readFile(new URL(`../../data/stroke-order/${key}.svg`, import.meta.url), "utf8");
  } catch {
    return null;
  }
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  if (start < 0 || end < 0) return null;
  return raw
    .slice(start, end + 6)
    .replace(/width="109"\s+height="109"/, "")
    .replace("<svg ", `<svg role="img" aria-label="Stroke order for ${esc(chars[0])}" `);
};

const dueLabel = (due: string | null) => {
  if (!due) return "Due now";
  const [y, m, d] = due.split("-").map(Number);
  if (!y || !m || !d) return `Due ${due}`;
  const now = new Date();
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days === 0) return "Due today";
  return days > 0 ? `Due in ${days} ${days === 1 ? "day" : "days"}` : `Due ${-days} ${-days === 1 ? "day" : "days"} ago`;
};

const firstSense = (s: unknown) => {
  const text = String(s ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return text.split(";")[0].trim().slice(0, 58);
};

const priorityInfo = (p: Priority): { icon: string; label: string } =>
  p === "high" ? { icon: "↑↑", label: "High" } :
  p === "medium" ? { icon: "↑", label: "Medium" } :
  p === "low" ? { icon: "", label: "Low" } : { icon: "", label: "Lowest" };

export const levelBadge = (label: string, p: Priority) => {
  const info = priorityInfo(p);
  return `<span class="badge" title="Priority ${info.label}" aria-label="${esc(label)}, priority ${info.label}">${esc(label)}${info.icon ? ` <span class="prio">${info.icon}</span>` : ""}</span>`;
};

export async function kanjiRedesignView(literal: string, base: string, q = "") {
  const k = db.query(`SELECT * FROM kanjis WHERE literal = ?`).get(literal) as Kanji | null;
  if (!k) return null;

  const img = await findImage(k.literal);
  const strokeSvg = await strokeOrderSvg(k.literal);
  const known = totalKnown();
  const score = Math.round(Number(k.score ?? 0) || 0);
  const label = masteryFor(score).label;
  const pct = Math.round(((score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100);
  const comps = [...new Set(String(k.components ?? "").split(/[;、,\s]+/).filter(Boolean))];
  const compKw = new Map(
    comps.length
      ? (db.query(`SELECT literal, keyword FROM kanjis WHERE literal IN (${comps.map(() => "?").join(",")})`).all(...comps) as { literal: string; keyword: string | null }[])
          .map((r) => [r.literal, keywordText(r.keyword).split(",")[0]])
      : [],
  );
  const compFor = db.query(`SELECT literal, keyword, jlpt, added, unfinished FROM kanjis WHERE components LIKE ? ESCAPE '\\' AND literal != ? ORDER BY COALESCE(added,0) DESC, COALESCE(jlpt,0) DESC LIMIT 10`)
    .all(`%${likeEsc(k.literal)}%`, k.literal) as Pick<Kanji, "literal" | "keyword" | "jlpt" | "added" | "unfinished">[];
  const addedWords = db.query(`SELECT * FROM examples WHERE kanji LIKE ? ESCAPE '\\' AND COALESCE(added, 0) = 1 ORDER BY COALESCE(freq_wiki, 999999)`)
    .all(`%${likeEsc(k.literal)}%`) as Word[];
  const history = db.query(`SELECT date, "before" AS b, "after" AS a, type FROM review_history WHERE kanji = ? ORDER BY date DESC, id DESC`).all(k.literal) as { date: string; b: number; a: number; type: string }[];

  const shortMeanings = meaningsText(k.meanings).split(", ").slice(0, 3).join(", ");
  const added = k.added === 1;
  const unfinished = k.unfinished === 1;
  const heroState = added ? (unfinished ? " hero-unfinished" : " hero-added") : "";
  const editHref = `/kanji/${enc(k.literal)}?${q ? `q=${enc(q)}&` : ""}edit=1`;
  const pageHref = `${base}/${enc(k.literal)}${q ? `?q=${enc(q)}` : ""}`;
  const badges = [
    k.jlpt ? levelBadge(`JLPT N${k.jlpt}`, jlptPriority(Number(k.jlpt), known)) : "",
    k.kanken ? levelBadge(`Kanken ${k.kanken}`, kankenPriority(Number(k.kanken), known)) : "",
  ].join("");
  const linkKanji = k.literal.trim();

  const compChips = comps.length
    ? comps.map((c) => {
        const kw = compKw.get(c) ?? "";
        return `<a class="comp" href="${base}/${enc(c)}${q ? `?q=${enc(q)}` : ""}"><b>${esc(c)}</b>${kw ? `<span>${esc(kw)}</span>` : ""}</a>`;
      }).join("")
    : "";
  const componentFor = compFor.length
    ? compFor.map((r) => {
        const state = r.added === 1 ? (r.unfinished === 1 ? " unf" : " in") : "";
        const status = r.added === 1 ? (r.unfinished === 1 ? "Unfinished" : "In your study list") : "";
        const dot = state ? `<i class="cdot${state}" role="img" aria-label="${status}" title="${status}"></i>` : "";
        const kw = keywordText(r.keyword);
        return `<a class="comp${state}" href="${base}/${enc(r.literal)}${q ? `?q=${enc(q)}` : ""}"><b>${esc(r.literal)}</b>${kw ? `<span>${esc(kw)}</span>` : ""}${dot}</a>`;
      }).join("")
    : `<span class="sub">Nothing else uses it.</span>`;

  const details = [
    ["On readings", k.onReadings ? readingList(k.onReadings) : null],
    ["Kun readings", k.kunReadings ? readingList(k.kunReadings) : null],
    ["Strokes", k.strokes], ["Grade", k.grade], ["JLPT", k.jlpt ? `N${k.jlpt}` : null],
    ["Kanken", k.kanken], ["Frequency", k.frequency ? `#${k.frequency}` : null],
  ].map(([lab, val]) => `<div class="detail"><span>${lab}</span><b>${val ?? "–"}</b></div>`).join("");

  const typeLabel: Record<string, string> = { bad: "Bad", neutral: "Neutral", good: "Good", easy: "Easy" };
  const typeDot: Record<string, string> = { bad: "red", neutral: "grey", good: "cyan", easy: "green" };
  const hRow = (h: { date: string; b: number; a: number; type: string }) =>
    `<div class="hrow"><i class="dot ${typeDot[h.type] ?? "grey"}"></i><span class="hdate">${esc(String(h.date).slice(0, 10))}</span><span class="htype">${esc(typeLabel[h.type] ?? h.type)}</span><b>${h.b} → ${h.a}</b></div>`;
  const shownHistory = history.slice(0, 5);
  const moreHistory = history.slice(5);

  const exRow = (w: Word) => {
    const text = splitKanjiMarker(w.kanji ?? "").text;
    const kana = String(w.kana ?? "").split(";")[0];
    const inList = w.added === 1;
    return `<div class="exrow" id="w${w.id}">
  <a class="exword" href="/?q=${enc(text)}" aria-label="Search for ${esc(text)}">${esc(text)}</a>
  <div class="exkana">${esc(kana)}</div>
  <div class="exmean" title="${esc(meaningsText(w.meanings))}">${esc(firstSense(w.meanings))}</div>
  ${w.jlpt ? `<span class="badge">N${esc(w.jlpt)}</span>` : ""}
  ${w.freq_wiki ? `<span class="badge">#${esc(w.freq_wiki)}</span>` : ""}
  <form method="post" action="/words/${w.id}/toggle"><input type="hidden" name="back" value="${esc(pageHref)}"><button class="pill ${inList ? "ghost rem" : "dark"} sm" type="submit">${inList ? "Remove" : "Add"}</button></form>
</div>`;
  };

  const body = `
<div class="grid" style="margin-top:18px">
  <div class="card hero${heroState}" style="grid-column:span 12">
    <div class="heroimg">
      ${img ? `<div class="pic"><img src="/img/${enc(k.literal)}" alt="${esc(k.literal)}"></div>` : `<div class="noimg">No image yet</div>`}
    </div>
    <div class="herobody">
      <div class="heroheader">
        <div class="herolinks">
          <a class="badge ext" href="https://www.kanshudo.com/kanji/${enc(linkKanji)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(linkKanji)} on Kanshudo">kanshudo</a>
          <a class="badge ext" href="https://en.wiktionary.org/wiki/${enc(linkKanji)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(linkKanji)} on Wiktionary">wiki</a>
        </div>
        <div class="badges">${badges}</div>
      </div>
      <div class="herotop">
        <div class="heroid">
          <div class="kbig">${esc(k.literal)}</div>
        </div>
        <div class="heroinfo">
          <div class="kw">${esc(keywordText(k.keyword)) || "No keyword yet"}</div>
          <div class="kmean">${esc(shortMeanings)}</div>
          ${compChips ? `<div class="comps">${compChips}</div>` : ""}
        </div>
      </div>
      <div class="herostory">
        <div class="story"><span class="story-label">Story</span>${k.story ? storyHtml(k.story).replace(/\n/g, "<br>") : "No story yet."}</div>
      </div>
      <div class="herofoot"><a class="pill ghost sm" href="${editHref}">Edit</a></div>
    </div>
  </div>

  <div class="card" style="grid-column:span 6">
    <div class="cardhead"><h3 class="h3">Details</h3></div>
    <div class="details">${details}</div>
  </div>

  <div class="card" style="grid-column:span 3;display:flex;flex-direction:column">
    <div class="cardhead"><h3 class="h3">Stroke order</h3>${strokeSvg ? `<button class="pill ghost sm stroke-play" type="button" hidden aria-label="Play stroke order animation">Play</button>` : ""}</div>
    <div class="stroke-card">${strokeSvg ? `<div class="stroke-order">${strokeSvg}</div>` : `<span class="sub">No stroke-order diagram.</span>`}</div>
  </div>

  <div class="card statcard" style="grid-column:span 3;display:flex;flex-direction:column">
    <div class="cardhead"><h3 class="h3">Review history</h3></div>
    <div style="display:flex;align-items:flex-end;gap:8px;margin-top:10px">
      <span class="scorebig">${score}</span><span style="color:var(--muted);font-size:11px;padding-bottom:7px">/ ${MAX_SCORE}</span>
    </div>
    <div class="sub" style="margin-top:3px">${esc(label)} · ${esc(dueLabel(k.due_date ?? null))}</div>
    <div class="seg" style="height:8px;margin:10px 0 8px"><i style="width:${pct}%;background:var(--cyan)"></i></div>
    <div class="sub">${k.last_reviewed ? `Last reviewed ${esc(String(k.last_reviewed).slice(0, 10))}` : "Never reviewed"}</div>
    ${history.length
      ? shownHistory.map(hRow).join("") + (moreHistory.length ? `<details class="hmore"><summary>Show ${moreHistory.length} more</summary>${moreHistory.map(hRow).join("")}</details>` : "")
      : `<div class="sub" style="padding:6px 0">No reviews yet.</div>`}
  </div>

  <div class="card" style="grid-column:span 6;display:flex;flex-direction:column">
    <div class="cardhead"><h3 class="h3">Examples in your list</h3><span class="badge">${addedWords.length} added</span></div>
    ${addedWords.length ? addedWords.map(exRow).join("") : `<div class="sub" style="padding:6px 0">No examples in your list yet.</div>`}
    <div class="exfoot"><a class="pill ghost sm" href="/?q=${enc(k.literal)}&type=words">Find more words</a></div>
  </div>

  <div class="card" style="grid-column:span 6">
    <div class="cardhead"><h3 class="h3">Component for</h3><span class="badge">${compFor.length} kanji</span></div>
    <div class="comps" style="margin-top:12px">${componentFor}</div>
  </div>
</div>
${strokeSvg ? `<script src="/js/stroke.js" defer></script>` : ""}`;

  return { title: `${k.literal} — Kanji`, body };
}

export async function designKanjiPage(literal: string) {
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = `/design/kanji/${enc(literal)}`;
  const view = await kanjiRedesignView(literal, "/design/kanji");
  if (!view) return messagePage("Kanji not found", `“${literal}” is not in the database.`, 404);
  return html(layout(view.title, view.body, { theme, back, lab: true }));
}
