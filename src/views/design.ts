import { db, totalKnown } from "../db";
import { enc, esc, html, likeEsc } from "../html";
import { findImage } from "../images";
import { MAX_SCORE, MIN_SCORE, masteryFor } from "../mastery";
import { storyHtml } from "../story";
import type { Kanji, Word } from "../types";
import { keywordText, meaningsText, readingList, splitKanjiMarker } from "./shared";

// a read-only design lab: the same data as the kanji page, rendered in the new visual language
const dueLabel = (due: string | null) => {
  if (!due) return "Due now";
  const [y, m, d] = due.split("-").map(Number);
  if (!y || !m || !d) return `Due ${due}`;
  const now = new Date();
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days === 0) return "Due today";
  return days > 0 ? `Due in ${days} ${days === 1 ? "day" : "days"}` : `Due ${-days} ${-days === 1 ? "day" : "days"} ago`;
};

// the first dictionary sense, without the grammar tags, for the compact word rows
const firstSense = (s: unknown) => {
  const text = String(s ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return text.split(";")[0].trim().slice(0, 58);
};

const labShell = (title: string, body: string) => `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/redesign.css">
</head>
<body>
<div class="panel">
<nav class="nav">
  <a class="brand" href="/" style="text-decoration:none;color:inherit">KANJI</a>
  <span class="labtag">design lab</span>
  <div class="navlinks">
    <a href="/my-list">My List</a><a href="/jlpt">JLPT</a><a href="/kanken">Kanken</a><a href="/stats">Stats</a>
  </div>
  <div class="navright">
    <form action="/" method="get" role="search" style="display:flex;align-items:center;gap:8px;background:#fff;border-radius:999px;padding:7px 12px;width:200px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input name="q" placeholder="Search" aria-label="Search" style="border:0;outline:0;background:transparent;font-family:inherit;font-size:11px;font-weight:700;width:100%">
    </form>
    <a class="pill dark" href="/review">Review</a>
    <a class="iconbtn" href="/settings" aria-label="Settings"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></a>
  </div>
</nav>
${body}
</div>
<script src="/js/layout.js" defer></script>
</body></html>`;

export async function designKanjiPage(literal: string) {
  const k = db.query(`SELECT * FROM kanjis WHERE literal = ?`).get(literal) as Kanji | null;
  if (!k) return html(labShell("Not found", `<div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);

  const img = await findImage(k.literal);
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
  const compFor = db.query(`SELECT literal, keyword, jlpt, added, unfinished FROM kanjis WHERE components LIKE ? ESCAPE '\\' AND literal != ? ORDER BY COALESCE(added,0) DESC, COALESCE(jlpt,0) DESC LIMIT 8`)
    .all(`%${likeEsc(k.literal)}%`, k.literal) as Pick<Kanji, "literal" | "keyword" | "jlpt" | "added" | "unfinished">[];
  const wordCount = (db.query(`SELECT COUNT(*) AS n FROM examples WHERE kanji LIKE ? ESCAPE '\\'`).get(`%${likeEsc(k.literal)}%`) as { n: number }).n;
  const words = db.query(`SELECT * FROM examples WHERE kanji LIKE ? ESCAPE '\\' ORDER BY COALESCE(added,0) DESC, COALESCE(freq_wiki, 999999) LIMIT 4`)
    .all(`%${likeEsc(k.literal)}%`) as Word[];

  const shortMeanings = meaningsText(k.meanings).split(", ").slice(0, 3).join(", ");
  const added = k.added === 1;
  const badges = [
    k.jlpt ? `<span class="badge cyan">JLPT N${esc(k.jlpt)}</span>` : "",
    k.kanken ? `<span class="badge">Kanken ${esc(k.kanken)}</span>` : "",
    k.grade ? `<span class="badge">Grade ${esc(k.grade)}</span>` : "",
    k.is_component === 1 ? `<span class="badge">Component</span>` : "",
  ].join("");
  const readings = [
    k.onReadings ? `<span><b>ON</b>${esc(readingList(k.onReadings))}</span>` : "",
    k.kunReadings ? `<span><b>KUN</b>${esc(readingList(k.kunReadings))}</span>` : "",
  ].join("");

  const equation = comps.length
    ? comps.map((c) => `<div class="eqbox"><b>${esc(c)}</b><span>${esc(compKw.get(c) ?? "")}</span></div>`).join('<span class="plus">+</span>')
    : `<span class="sub">No components recorded.</span>`;

  const details = [
    ["Strokes", k.strokes], ["Grade", k.grade], ["JLPT", k.jlpt ? `N${k.jlpt}` : null],
    ["Kanken", k.kanken], ["Frequency", k.frequency ? `#${k.frequency}` : null], ["Heisig 6", k.heisg6],
  ].map(([lab, val]) => `<div class="detail"><span>${lab}</span><b>${val ?? "–"}</b></div>`).join("");

  const componentFor = compFor.length
    ? compFor.map((r) => `<div class="comp"><b>${esc(r.literal)}</b><span>${esc(keywordText(r.keyword)) || "–"}</span></div>`).join("")
    : `<span class="sub">Nothing else uses it yet.</span>`;

  const examples = words.length
    ? words.map((w) => {
        const { text, marker } = splitKanjiMarker(w.kanji ?? "");
        const addedWord = w.added === 1;
        return `<div class="exrow">
  <div class="exword">${esc(text)}${marker ? `<span style="font-size:9px;color:#8b909a">${esc(marker)}</span>` : ""}</div>
  <div class="exkana">${esc(String(w.kana ?? "").split(";")[0])}</div>
  <div class="exmean" title="${esc(meaningsText(w.meanings))}">${esc(firstSense(w.meanings))}</div>
  ${w.jlpt ? `<span class="badge">N${esc(w.jlpt)}</span>` : ""}
  ${addedWord ? `<span class="badge cyan">In list</span>` : `<a class="pill dark sm" href="/?q=${enc(w.kanji ?? w.kana ?? "")}">Open</a>`}
</div>`;
      }).join("")
    : `<span class="sub">No example words yet.</span>`;

  const body = `
<div class="head" style="margin-bottom:14px">
  <div>
    <div class="crumb">Design lab / 土</div>
    <h1><span style="font-family:'Noto Serif JP',Jigmo,serif;font-size:44px;vertical-align:-4px">${esc(k.literal)}</span> <span style="font-size:22px;color:#8b909a;font-weight:400;letter-spacing:-.01em">${esc(shortMeanings)}</span></h1>
    <div class="sub">${k.jlpt ? `N${k.jlpt}` : "No JLPT"} · ${k.grade ? `Grade ${k.grade}` : "No grade"} · ${k.strokes ?? "?"} strokes${k.added_at ? ` · added ${esc(String(k.added_at).slice(0, 10))}` : ""}</div>
  </div>
  <div style="display:flex;gap:7px">
    <a class="pill ghost" href="/kanji/${enc(k.literal)}">Current page</a>
    <a class="pill dark" href="/review/${enc(k.literal)}">Review</a>
  </div>
</div>

<div class="grid">
  <div class="card hero" style="grid-column:span 8">
    <div class="heroimg">
      ${img ? `<div class="pic"><img src="/img/${enc(k.literal)}" alt="${esc(k.literal)}"></div>` : `<div class="noimg">No image yet</div>`}
      <div class="cap"><i class="dot cyan"></i> ${esc(k.literal)} · ${esc(shortMeanings.split(",")[0] ?? "")}</div>
    </div>
    <div class="herobody">
      <div class="masteryline"><span class="dot cyan"></span> ${esc(label)} · Score ${score} · ${esc(dueLabel(k.due_date ?? null))}</div>
      <div>
        <div class="kbig">${esc(k.literal)}</div>
        <div class="kw">${esc(keywordText(k.keyword)) || "No keyword yet"}</div>
        <div class="kmean">${esc(shortMeanings)}</div>
        <div class="badges">${badges}</div>
      </div>
      <div class="readings">${readings}</div>
    </div>
  </div>

  <div class="card dark" style="grid-column:span 4;display:flex;flex-direction:column">
    <div class="cardhead"><h3 class="h3" style="color:#f3f4f6">Mastery</h3><span class="more"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 17L17 7M9 7h8v8"/></svg></span></div>
    <div style="display:flex;align-items:flex-end;gap:8px;margin-top:12px">
      <span class="scorebig" style="color:#fff">${score}</span><span style="color:#9ea2aa;font-size:11px;padding-bottom:7px">/ ${MAX_SCORE}</span>
    </div>
    <div class="sub" style="color:#a9adb5;margin-top:4px">${esc(label)} · ${esc(dueLabel(k.due_date ?? null))}</div>
    <div class="seg" style="background:#2a2c31;height:8px;margin:12px 0 8px"><i style="width:${pct}%;background:var(--cyan)"></i></div>
    <div class="sub" style="color:#7f848d">${k.last_reviewed ? `Last reviewed ${esc(String(k.last_reviewed).slice(0, 10))}` : "Never reviewed"}</div>
    <div class="answers">
      <form method="post" action="/review/${enc(k.literal)}/bad"><button class="answer">Bad <span>A</span></button></form>
      <form method="post" action="/review/${enc(k.literal)}/neutral"><button class="answer">Neutral <span>S</span></button></form>
      <form method="post" action="/review/${enc(k.literal)}/good"><button class="answer good">Good <span>D</span></button></form>
      <form method="post" action="/review/${enc(k.literal)}/easy"><button class="answer">Easy <span>F</span></button></form>
    </div>
    <div class="sub" style="color:#7f848d;margin-top:auto;padding-top:10px">${added ? "In your study list" : "Not in your study list yet"} · ${known} known</div>
  </div>

  <div class="card" style="grid-column:span 8">
    <div class="cardhead"><h3 class="h3">Components</h3><span class="badge">${comps.length} part${comps.length === 1 ? "" : "s"}</span></div>
    <div class="equation">${equation}<span class="plus">→</span><div class="eqbox hot"><b>${esc(k.literal)}</b><span>${esc(shortMeanings.split(",")[0] ?? "")}</span></div></div>
    <div class="sub" style="margin-top:0">Component for</div>
    <div class="comps">${componentFor}</div>
  </div>

  <div class="card" style="grid-column:span 4">
    <div class="cardhead"><h3 class="h3">Details</h3><span class="more"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 17L17 7M9 7h8v8"/></svg></span></div>
    <div class="details">${details}</div>
  </div>

  <div class="card" style="grid-column:span 6;display:flex;flex-direction:column">
    <div class="cardhead"><h3 class="h3">Story</h3>${k.keyword ? `<span class="badge cyan">${esc(keywordText(k.keyword))}</span>` : ""}</div>
    <div class="story">${k.story ? storyHtml(k.story).replace(/\n/g, "<br>") : "No story yet."}</div>
    <div class="sub" style="margin-top:8px">=keyword= · _component_ · ?note? · #link#</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:10px">
      <span class="sub">Saved with the kanji</span>
      <a class="pill ghost sm" href="/kanji/${enc(k.literal)}?edit=1">Edit story</a>
    </div>
  </div>

  <div class="card" style="grid-column:span 6">
    <div class="cardhead"><h3 class="h3">Examples</h3><a class="pill ghost sm" href="/?q=${enc(k.literal)}">${wordCount} words</a></div>
    ${examples}
  </div>
</div>`;

  return html(labShell(`${k.literal} — design lab`, body));
}
