import { totalKnown } from "../db";
import { enc, esc, highlight, html, toKata } from "../html";
import { requestContext } from "../prefs";
import { romajiToHiragana } from "../romaji";
import { search, shortQuery } from "../search";
import { wordResultsPerPage } from "../settings";
import type { Kanji, Word } from "../types";
import { dashboardView } from "./dashboard";
import { levelBadge } from "./design";
import { recordHistory } from "../history";
import { layout } from "./layout";
import { jlptPriority, kankenPriority, keywordText, meaningGroups, meaningsText, readingList, splitKanjiMarker } from "./shared";

const kanjiRow = (k: Kanji, q: string, known: number) => {
  const readings = [readingList(k.onReadings), readingList(k.kunReadings)].filter(Boolean).join(" · ");
  const low = k.low_priority === 1;
  const state = k.added === 1 ? (k.unfinished === 1 ? " unf" : " in") : "";
  const badges = [
    k.jlpt ? levelBadge(`JLPT N${k.jlpt}`, jlptPriority(Number(k.jlpt), known)) : "",
    k.kanken ? levelBadge(`Kanken ${k.kanken}`, kankenPriority(Number(k.kanken), known)) : "",
    low ? `<span class="badge low">Low priority</span>` : "",
  ].join("");
  return `<div class="resultrow kanjirow${low ? " lowpriority" : ""}">
    <a class="rtile ktile${state}" href="/kanji/${enc(k.literal)}?q=${enc(q)}" aria-label="Open ${esc(k.literal)}">${esc(k.literal)}</a>
    <div class="rmain">
      ${k.keyword ? `<div class="rkw">${highlight(keywordText(k.keyword), q)}</div>` : ""}
      <div class="rmean">${highlight(meaningsText(k.meanings), q)}</div>
      ${readings ? `<div class="rread">${highlight(readings, q)}</div>` : ""}
    </div>
    <div class="rright">${badges}</div>
  </div>`;
};

const KANJI_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}々〇]/u;
const hasKanji = (text: string) => KANJI_CHAR.test(text);

// the whole displayed word is one search link, not separate clickable kanji runs
const wordMarkup = (text: string, q: string) => highlight(text, q);


const wordRow = (w: Word, back: string, q: string) => {
  const inList = w.added === 1;
  const hq = q.replace(/[*+]/g, "");
  const raw = w.kanji ? splitKanjiMarker(w.kanji) : { text: "", marker: "" };
  const readings = String(w.kana ?? "").split(";").map((r) => r.trim()).filter(Boolean);
  const kana = readings[0] ?? "";
  const word = raw.text || kana;
  const alternativeForms = String(w.kanji_alternative ?? "").split(";").map((s) => s.trim()).filter((s) => s && s !== word);
  const wordDisplay = hasKanji(word)
    ? `<a class="wordlink" href="/?q=${enc(word)}" aria-label="Search for ${esc(word)}">${wordMarkup(word, hq)}</a>${alternativeForms.length ? `; ${alternativeForms.map((form) => highlight(form, hq)).join("; ")}` : ""}`
    : wordMarkup(word, hq);
  const readingText = readings.map((r) => highlight(r, hq)).join("; ");
  return `<div class="resultrow wordrow" id="w${w.id}">
    <div class="rmain">
      <div class="rkw">${wordDisplay}${kana && kana !== word ? ` <span class="rread">（${readingText}）</span>` : ""}</div>
      <div class="rmean">${meaningGroups(w.meanings).map((m) => `<span class="sense">${highlight(m, hq)}</span>`).join("")}</div>
    </div>
    <div class="rright">
      ${w.jlpt ? `<span class="badge">N${esc(w.jlpt)}</span>` : ""}
      ${w.freq_wiki ? `<span class="badge">#${esc(w.freq_wiki)}</span>` : ""}
      <form method="post" action="/words/${w.id}/toggle"><input type="hidden" name="back" value="${esc(back)}"><button class="pill ${inList ? "ghost rem" : "dark"} sm" type="submit">${inList ? "Remove" : "Add"}</button></form>
    </div>
  </div>`;
};

const scriptAlt = (q: string, type: string) => {
  const hira = romajiToHiragana(q);
  if (!hira) return "";
  const link = (text: string) => shortQuery(text) ? "" : `<a href="/?q=${enc(text)}&type=${type}">${esc(text)}</a>`;
  const links = [link(hira), link(toKata(hira))].filter(Boolean);
  return links.length ? ` (search for ${links.join(" / ")} instead)` : "";
};

const searchTips = () => `<details class="search-tips">
  <summary>Search tips</summary>
  <div class="search-tips-panel">
    <div class="search-tips-title">Search tips</div>
    <div class="search-tips-group">
      <b>Word wildcards</b>
      <p><code>*</code> matches zero or more characters: <code>*日</code> ends with 日, <code>日*</code> starts with 日, <code>*日*</code> contains 日.</p>
      <p><code>+</code> matches one or more characters: <code>+日</code> needs at least one character before 日, and <code>日+</code> needs at least one after it.</p>
    </div>
    <div class="search-tips-group">
      <b>Keyboard</b>
      <p><kbd>Tab</kbd> cycles romaji ↔ hiragana in the main search bar. The next form is previewed below the field.</p>
    </div>
  </div>
</details>`;

const hero = (message = "") => `<div class="searchhero">
  <div class="crumb">Search</div>
  <h1>Find a kanji</h1>
  <p class="sub">Use the search bar above to search by character, keyword, meaning, reading or romaji.</p>
  ${message ? `<p class="sub" style="margin-top:14px">${message}</p>` : ""}
  ${searchTips()}
</div>`;

export function home(url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const t = url.searchParams.get("type");
  const type = t === "kanji" || t === "words" ? t : "all";
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = `${url.pathname}${url.search}`;
  const page = (title: string, body: string) => html(layout(title, body, { theme, back, searchValue: q }));

  if (!q) {
    const days = Number(url.searchParams.get("days") ?? 30);
    const dash = dashboardView(days);
    return page(dash.title, dash.body);
  }
  if (shortQuery(q)) return page("Search – Kanji", hero("Enter at least two characters to search."));
  if (!url.searchParams.has("type")) recordHistory("search", q);

  const found = search(q);
  const kanji = found.kanji;
  const words = found.words;
  const known = totalKnown();
  const wordTotal = words.length;
  const perPage = wordResultsPerPage();
  const pageCount = Math.max(1, Math.ceil(wordTotal / perPage));
  const requestedPage = Number(url.searchParams.get("page") ?? 1);
  const wordPage = Number.isInteger(requestedPage) ? Math.min(pageCount, Math.max(1, requestedPage)) : 1;
  const pageWords = words.slice((wordPage - 1) * perPage, wordPage * perPage);
  const wordPageUrl = (p: number) => `/?q=${enc(q)}&type=words${p > 1 ? `&page=${p}` : ""}`;
  // pagination belongs to the word list; page 2+ always uses the Words view so the kanji card doesn't repeat
  if (type === "all" && wordPage > 1) {
    return new Response(null, { status: 303, headers: { location: wordPageUrl(wordPage) } });
  }
  const backTo = `/?q=${enc(q)}&type=${type}${wordPage > 1 ? `&page=${wordPage}` : ""}`;
  const tab = (id: string, label: string, count: number) =>
    `<a class="tab${type === id ? " on" : ""}" href="/?q=${enc(q)}&type=${id}">${label} ${count}</a>`;
  const alt = scriptAlt(q, type);
  const resultHead = `<div class="resulthead"><h2>Results for “${esc(q)}”${alt ? `<span class="alt">${alt}</span>` : ""}</h2><div class="resulthead-row"><div class="tabs">${tab("all", "All", kanji.length + wordTotal)}${tab("kanji", "Kanji", kanji.length)}${tab("words", "Words", wordTotal)}</div>${searchTips()}</div></div>`;

  const pageControls = (top = false) => {
    if (pageCount <= 1) return "";
    const first = wordPage > 1
      ? `<a class="pill ghost sm" rel="first" href="${wordPageUrl(1)}">« First</a>`
      : `<span class="pill ghost sm disabled" aria-disabled="true">« First</span>`;
    const prev = wordPage > 1
      ? `<a class="pill ghost sm" rel="prev" href="${wordPageUrl(wordPage - 1)}">← Previous</a>`
      : `<span class="pill ghost sm disabled" aria-disabled="true">← Previous</span>`;
    const next = wordPage < pageCount
      ? `<a class="pill ghost sm" rel="next" href="${wordPageUrl(wordPage + 1)}">Next →</a>`
      : `<span class="pill ghost sm disabled" aria-disabled="true">Next →</span>`;
    const last = wordPage < pageCount
      ? `<a class="pill ghost sm" rel="last" href="${wordPageUrl(pageCount)}">Last »</a>`
      : `<span class="pill ghost sm disabled" aria-disabled="true">Last »</span>`;
    return `<div class="pagination${top ? " top" : ""}">${first}${prev}<span class="sub">Page ${wordPage} of ${pageCount}</span>${next}${last}</div>`;
  };

  let sections = "";
  if (type !== "words" && kanji.length) {
    sections += `<div class="card" style="grid-column:span 12">
      <div class="section-label"><h3>Kanji</h3><span class="sub">${kanji.length}</span></div>
      <div class="kanji-grid">${kanji.map((k) => kanjiRow(k, q, known)).join("")}</div>
    </div>`;
  }
  if (type !== "kanji" && wordTotal) {
    sections += `<div class="card" style="grid-column:span 12">
      <div class="section-label"><h3>Words</h3><span class="sub">${wordTotal}</span></div>
      ${pageControls(true)}
      ${pageWords.map((w) => wordRow(w, backTo, q)).join("")}
      ${pageControls()}
    </div>`;
  }
  if (!sections) sections = `<div class="card" style="grid-column:span 12"><div class="sub" style="padding:18px 0">Nothing found for “${esc(q)}”. Try another spelling or a shorter search.</div></div>`;

  const body = `${resultHead}<div class="grid">${sections}</div>`;
  return page(`${q} – Kanji`, body);
}
