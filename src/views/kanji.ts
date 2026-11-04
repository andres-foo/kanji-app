import { db, totalKnown } from "../db";
import { enc, esc, html, likeEsc, nullsLast } from "../html";
import { findImage } from "../images";
import { masteryFor } from "../mastery";
import { requestContext } from "../prefs";
import { REVIEW_BUTTONS, REVIEW_KEYS, REVIEW_PAD } from "../review";
import { storyHtml } from "../story";
import type { Kanji, Word } from "../types";
import { layout } from "./layout";
import { jlptBadge, kankenBadge, keywordText, meaningGroups, meanings, readingList, splitKanjiMarker } from "./shared";

// link every character of a field that is itself a kanji in the database
function linkKanji(s: string | null, q: string) {
  const chars = [...new Set(s?.match(/\p{Script=Han}/gu) ?? [])];
  if (!chars.length) return s ? esc(s) : "–";
  const found = new Set(
    (db.query(`SELECT literal FROM kanjis WHERE literal IN (${chars.map(() => "?").join(",")})`).all(...chars) as { literal: string }[]).map((r) => r.literal),
  );
  return chars.map((c) => found.has(c)
    ? `<a class="kl k" href="/kanji/${enc(c)}?q=${enc(q)}">${esc(c)}</a>` : `<span class="kl k">${esc(c)}</span>`).join("");
}

const plain = (v: unknown) => (v ? esc(v) : "–");
const readings = (s: string | null) => { const value = readingList(s); return value ? esc(value) : "–"; };

// example words containing the kanji: added ones first, then words with a jlpt level or wiki frequency;
// the rest are hidden behind a toggle (a native <details>, so no JavaScript is needed)
function exampleWords(literal: string, back: string) {
  const pat = `%${likeEsc(literal)}%`;
  const words = db.query(`SELECT * FROM examples WHERE kanji LIKE ? ESCAPE '\\' OR kanji_alternative LIKE ? ESCAPE '\\'`).all(pat, pat) as Word[];
  if (!words.length) return "";
  const rank = (w: Word) => (w.added === 1 ? 0 : w.jlpt || w.freq_wiki || w.kanji?.includes("(P)") ? 1 : 2);
  words.sort((a, b) => rank(a) - rank(b) || nullsLast(a.freq_wiki || null, b.freq_wiki || null) || (b.jlpt ?? 0) - (a.jlpt ?? 0));

  const button = (w: Word) => {
    const added = w.added === 1;
    const target = (w.kanji ? splitKanjiMarker(w.kanji).text : "") || w.kana || "";
    const label = w.kanji || w.kana || "";
    const face = `<span class="k">${esc(label)}</span>${w.jlpt ? `<span class="b">N${esc(w.jlpt)}</span>` : ""}${w.freq_wiki ? `<span class="b">#${esc(w.freq_wiki)}</span>` : ""}`;
    const toggle = `<form method="post" action="/words/${w.id}/toggle"><input type="hidden" name="back" value="${esc(back)}"><button class="btn ${added ? "rem" : "add"}" type="submit">${added ? "Remove" : "Add"}</button></form>`;
    const tip = `<div class="tip"><div class="tipbox"><div class="tiptop"><span class="k wk"><a class="wlink" href="/?q=${enc(target)}" aria-label="Search for ${esc(target)}">${esc(label)}</a>${w.kanji && w.kana ? `<span class="kana">「${esc(w.kana)}」</span>` : ""}${w.kanji_alternative ? `<span class="alt">also ${esc(w.kanji_alternative)}</span>` : ""}</span>${toggle}</div><span class="wm">${meaningGroups(w.meanings).map((m) => `<span class="sense">${esc(m)}</span>`).join("")}</span></div></div>`;
    return `<div class="exw" id="w${w.id}"><a class="ex${added ? " added" : ""}" href="/?q=${enc(target)}" aria-label="Search for ${esc(target)}${added ? " (in your study list)" : ""}">${face}</a>${tip}</div>`;
  };

  const shown = words.filter((w) => rank(w) < 2);
  const hidden = words.filter((w) => rank(w) === 2);
  return `<div class="examples">
<div class="ex-head">Examples</div>
${shown.length ? `<div class="exs">${shown.map(button).join("")}</div>` : ""}
${hidden.length ? `<details class="exmore"><summary><span class="s-closed">Show ${hidden.length} more</span><span class="s-open">Hide ${hidden.length} more</span></summary><div class="exs">${hidden.map(button).join("")}</div></details>` : ""}
</div>`;
}

// every other kanji that lists this one as a component, as links to those kanji (green/red border when added/unfinished)
function componentOf(literal: string, q: string) {
  const rows = db.query(`SELECT literal, keyword, jlpt, frequency, added, unfinished FROM kanjis WHERE components LIKE ? ESCAPE '\\' AND literal != ?`)
    .all(`%${likeEsc(literal)}%`, literal) as Pick<Kanji, "literal" | "keyword" | "jlpt" | "frequency" | "added" | "unfinished">[];
  if (!rows.length) return "";
  rows.sort((a, b) => (b.jlpt ?? 0) - (a.jlpt ?? 0) || nullsLast(a.frequency, b.frequency));
  const buttons = rows.map((r) => {
    const state = r.added === 1 ? (r.unfinished === 1 ? "unfinished" : "added") : "";
    const kw = keywordText(r.keyword);
    const status = state === "unfinished" ? " (unfinished)" : state === "added" ? " (in your study list)" : "";
    return `<a class="comp${state ? ` ${state}` : ""}" href="/kanji/${enc(r.literal)}${q ? `?q=${enc(q)}` : ""}" aria-label="Open ${esc(r.literal)}${kw ? ` (${esc(kw)})` : ""}${status}"><span class="k">${esc(r.literal)}</span>${kw ? `<span class="ckw">${esc(kw)}</span>` : ""}</a>`;
  });
  return `<div class="examples">
<div class="ex-head">Component for:</div>
<div class="exs">${buttons.join("")}</div>
</div>`;
}

// one button per component character: a link to its own kanji page when it is a kanji in the database,
// otherwise (e.g. a radical that is not in the database) a search for it; shows its keyword when it has one
function componentButtons(s: string | null, q = "") {
  const chars = [...new Set([...(s ?? "")].filter((c) => !/[\s,、;；，]/.test(c)))];
  if (!chars.length) return "";
  const keywords = new Map(
    (db.query(`SELECT literal, keyword FROM kanjis WHERE literal IN (${chars.map(() => "?").join(",")})`).all(...chars) as { literal: string; keyword: string | null }[])
      .map((r) => [r.literal, keywordText(r.keyword)]),
  );
  const buttons = chars.map((c) => {
    const kw = keywords.get(c);
    const inDb = keywords.has(c);
    const href = inDb ? `/kanji/${enc(c)}${q ? `?q=${enc(q)}` : ""}` : `/?q=${enc(c)}`;
    return `<a class="comp" href="${href}" aria-label="${inDb ? "Open" : "Search for"} ${esc(c)}${kw ? ` (${esc(kw)})` : ""}"><span class="k">${esc(c)}</span>${kw ? `<span class="ckw">${esc(kw)}</span>` : ""}</a>`;
  });
  return `<div class="comps">${buttons.join("")}</div>`;
}

// the due part of the kanji page header: relative wording plus the same colour classes as the Stats page
// and the navbar counter (green = no due date, blue = due today, red = overdue; future dates stay neutral)
function dueLabel(due: string | null): { text: string; cls: string } {
  if (!due) return { text: "Due now", cls: "kdue-fresh" };
  const [y, m, d] = due.split("-").map(Number);
  if (!y || !m || !d) return { text: `Due ${due}`, cls: "" };
  const now = new Date();
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days === 0) return { text: "Due today", cls: "kdue-today" };
  if (days > 0) return { text: `Due in ${days} ${days === 1 ? "day" : "days"}`, cls: "" };
  const ago = -days;
  return { text: `Due ${ago} ${ago === 1 ? "day" : "days"} ago`, cls: "kdue-overdue" };
}

export async function kanjiPage(literal: string, url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const k = db.query(`SELECT * FROM kanjis WHERE literal = ?`).get(literal) as Kanji | null;
  const back = q ? `/?q=${enc(q)}` : "/";
  if (!k) return html(layout("Not found", q, `<div><a class="back" href="${back}">Back</a></div><div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);

  const img = await findImage(k.literal);
  const state = k.added === 1 ? (k.unfinished === 1 ? "unfinished" : "added") : "";
  const status = state === "unfinished" ? `<span class="sr">Unfinished</span>` : state === "added" ? `<span class="sr">In your study list</span>` : "";
  const known = totalKnown();
  // the score and the next review, shown as a small line at the top left of the card instead of a badge
  const masteryScore = Math.round(Number(k.score ?? 0) || 0);
  const due = dueLabel(k.due_date ?? null);
  const masteryLine = k.added === 1
    ? `<div class="kmeta"><span>${esc(masteryFor(masteryScore).label)}</span><span class="ksep">/</span><span>Score ${masteryScore}</span><span class="ksep">/</span><span class="${due.cls}">${esc(due.text)}</span></div>`
    : "";
  const item = (label: string, v: string) => `<div><div class="lab">${label}</div><div class="val">${v}</div></div>`;
  const inList = k.added === 1;
  const self = `/kanji/${enc(k.literal)}${q ? `?q=${enc(q)}` : ""}`;
  const detailsOpen = requestContext.getStore()?.detailsOpen ?? true;
  const here = `${self}#details`;
  const editing = url.searchParams.get("edit") === "1";
  const editHref = `/kanji/${enc(k.literal)}?${q ? `q=${enc(q)}&` : ""}edit=1`;
  const field = (name: string, label: string, value: string | null) =>
    `<label class="fl">${label}<input type="text" name="${name}" value="${esc(value)}" autocomplete="off"></label>`;
  const check = (name: string, label: string, on: boolean) =>
    `<label class="check"><input type="checkbox" name="${name}" value="1"${on ? " checked" : ""}>${label}</label>`;
  // the story field: a formatted editor for =keyword= _component_ ?note? #link# (public/js/story-editor.js),
  // which falls back to the plain code textarea when JavaScript is off
  const storyField = `<div class="storyfield">
<span class="flab" id="storylab">Story</span>
<div class="storytools" id="storytools" role="toolbar" aria-label="Story formatting" hidden>
<button type="button" class="tool" data-mark="=" title="Keyword: =text=">= Keyword</button>
<button type="button" class="tool" data-mark="_" title="Component: _text_">_ Component</button>
<button type="button" class="tool" data-mark="?" title="Note: ?text?">? Note</button>
<button type="button" class="tool" data-mark="#" title="Link: #text#"># Link</button>
<span class="sp"></span>
<button type="button" class="tool" id="storymode" aria-pressed="false">Show code</button>
</div>
<div class="storyed" id="storyed" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="storylab" hidden></div>
<textarea name="story" id="storycode" aria-label="Story">${esc(k.story)}</textarea>
</div>`;
  const editForm = `<form class="editf" id="editform" method="post" action="/kanji/${enc(k.literal)}/edit">
<input type="hidden" name="back" value="${esc(self)}">
${field("keyword", "Keyword", k.keyword)}
${field("components", "Components", k.components)}
${field("other_forms", "Other forms", k.other_forms)}
${field("related", "Related", k.related)}
${storyField}
<div class="checks">${check("added", "Added", k.added === 1)}${check("unfinished", "Unfinished", k.unfinished === 1)}${check("is_component", "Is component", k.is_component === 1)}</div>
</form>`;
  const detailsBody = detailsOpen ? `<div class="ds">
${item("Strokes", plain(k.strokes))}${item("Grade", plain(k.grade))}
${item("On readings", readings(k.onReadings))}${item("Kun readings", readings(k.kunReadings))}${item("Frequency", plain(k.frequency))}${item("Heisig 6", plain(k.heisg6))}
${item("Related", linkKanji(k.related, q))}${item("Other forms", linkKanji(k.other_forms, q))}
</div>` : "";
  const lit = esc(k.literal);
  const imgForm = `<input type="hidden" name="back" value="${esc(editHref)}">`;
  const picBlock = `<div class="picwrap">
${img
      ? `<div class="pic"><img src="/img/${enc(k.literal)}" alt="Image for ${lit}" tabindex="0" title="Click to enlarge"></div>`
      : `<div class="pic ph"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>No image yet</div>`}
${editing ? `<div class="picbtns">
<form method="post" action="/kanji/${enc(k.literal)}/image" enctype="multipart/form-data">${imgForm}
<label class="picbtn"><input class="sr" type="file" name="image" accept="image/jpeg,image/png" aria-label="Upload an image for ${lit}" onchange="this.form.requestSubmit()">Upload</label></form>
${img ? `<form method="post" action="/kanji/${enc(k.literal)}/image/delete" data-msg="Remove the image for ${lit}?" onsubmit="return confirm(this.dataset.msg)">${imgForm}
<button class="picbtn" type="submit" aria-label="Remove the image for ${lit}">Remove</button></form>` : ""}
</div>` : ""}</div>`;
  const detailsBlock = `<div class="details${detailsOpen ? " open" : ""}" id="details">
<form class="details-toggle" method="post" action="/details/toggle">
<input type="hidden" name="details" value="${detailsOpen ? "closed" : "open"}">
<input type="hidden" name="back" value="${esc(here)}">
<button type="submit" aria-expanded="${detailsOpen}"><span>Details</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>
</form>
${detailsBody}
</div>`;
  // the actions live in this row at the bottom right; Save submits the edit form through its form attribute (adding or removing a kanji is the "Added" checkbox in that form)
  const actionsRow = `<div class="pagetop">
${status}
<div class="actions">
${editing
      ? `<a class="btn edit" href="${esc(self)}">Cancel</a><button class="btn add" type="submit" form="editform">Save</button>`
      : `<a class="btn edit" href="${esc(editHref)}" aria-label="Edit ${esc(k.literal)}">Edit</a>`}
</div></div>`;
  const body = `
<div class="kanji-card${state ? ` ${state}` : ""}">
${masteryLine}
<div class="detail">
<div class="right">
<div class="top">
<div class="big k">${esc(k.literal)}</div>
${k.keyword ? `<div class="kwbig">${esc(keywordText(k.keyword))}</div>` : ""}<div class="meanbig${k.keyword ? "" : " no-kw"}">${meanings(k.meanings)}${k.jlpt || k.kanken ? `<div class="levels">${jlptBadge(k, known)}${kankenBadge(k, known)}</div>` : ""}</div>
</div>
${componentButtons(k.components, q)}
</div>
${picBlock}
</div>
${k.story ? `<div class="story-paper"><div class="story">${storyHtml(k.story).replace(/\n/g, "<br>")}</div></div>` : ""}
${editing ? `${editForm}
<script src="/js/story-editor.js" defer></script>
${actionsRow}` : `${actionsRow}
${detailsBlock}
${exampleWords(k.literal, self)}
${componentOf(k.literal, q)}`}
</div>`;
  // reached through "Show answer": bad / neutral / good / easy buttons (each saves the result using the score changes from the settings) instead of the plain review link
  const reviewBar = url.searchParams.get("review") === "1"
    ? REVIEW_BUTTONS
      .map(([id, label], i) => `<form method="post" action="/review/${enc(k.literal)}/${id}"><button class="reviewbtn ${id}" type="submit" aria-keyshortcuts="${REVIEW_KEYS[i]}"><kbd class="kbd">${REVIEW_KEYS[i]}</kbd><span class="pad">${REVIEW_PAD[i]}</span>${label}</button></form>`).join("")
    : undefined;
  return html(layout(`${k.literal} – Kanji`, q, body, "", reviewBar));
}
