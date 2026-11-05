import { totalKnown } from "../db";
import { enc, esc, highlight, html, toKata } from "../html";
import { requestContext } from "../prefs";
import { romajiToHiragana } from "../romaji";
import { search, shortQuery } from "../search";
import type { Kanji, Word } from "../types";
import { levelBadge } from "./design";
import { layout } from "./layout";
import { jlptPriority, kankenPriority, keywordText, meaningGroups, meaningsText, readingList, splitKanjiMarker } from "./shared";

const statusDot = (k: Kanji) => {
  if (k.added !== 1) return "";
  const label = k.unfinished === 1 ? "Unfinished" : "In your study list";
  return `<i class="sdot ${k.unfinished === 1 ? "unf" : "in"}" role="img" aria-label="${label}" title="${label}"></i>`;
};

const kanjiRow = (k: Kanji, q: string, known: number) => {
  const readings = [readingList(k.onReadings), readingList(k.kunReadings)].filter(Boolean).join(" · ");
  const badges = [
    k.jlpt ? levelBadge(`JLPT N${k.jlpt}`, jlptPriority(Number(k.jlpt), known)) : "",
    k.kanken ? levelBadge(`Kanken ${k.kanken}`, kankenPriority(Number(k.kanken), known)) : "",
  ].join("");
  return `<div class="resultrow kanjirow">
    <a class="rtile ktile" href="/kanji/${enc(k.literal)}?q=${enc(q)}" aria-label="Open ${esc(k.literal)}">${esc(k.literal)}${statusDot(k)}</a>
    <div class="rmain">
      ${k.keyword ? `<div class="rkw">${highlight(keywordText(k.keyword), q)}</div>` : ""}
      <div class="rmean">${highlight(meaningsText(k.meanings), q)}</div>
      ${readings ? `<div class="rread">${highlight(readings, q)}</div>` : ""}
    </div>
    <div class="rright">${badges}</div>
  </div>`;
};

const wordRow = (w: Word, back: string, q: string) => {
  const inList = w.added === 1;
  const raw = w.kanji ? splitKanjiMarker(w.kanji) : { text: "", marker: "" };
  const kana = String(w.kana ?? "").split(";")[0];
  const word = raw.text || kana;
  return `<div class="resultrow wordrow" id="w${w.id}">
    <div class="rmain">
      <div class="rkw">${highlight(word, q)}${kana && kana !== word ? ` <span class="rread">（${highlight(kana, q)}）</span>` : ""}</div>
      <div class="rmean">${meaningGroups(w.meanings).map((m) => `<span class="sense">${highlight(m, q)}</span>`).join("")}</div>
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

const hero = (message = "") => `<div class="searchhero">
  <div class="crumb">Search</div>
  <h1>Find a kanji</h1>
  <p class="sub">Use the search bar above to search by character, keyword, meaning, reading or romaji.</p>
  ${message ? `<p class="sub" style="margin-top:14px">${message}</p>` : ""}
</div>`;

export function home(url: URL) {
  const raw = url.searchParams.get("q");
  const q = (raw ?? "").trim().slice(0, 100);
  const t = url.searchParams.get("type");
  const type = t === "kanji" || t === "words" ? t : "all";
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = `${url.pathname}${url.search}`;
  const page = (title: string, body: string) => html(layout(title, body, { theme, back, searchValue: q }));

  if (!q) return page("Search – Kanji", hero(raw === null ? "" : "Enter at least two characters to search."));
  if (shortQuery(q)) return page("Search – Kanji", hero("Enter at least two characters to search."));

  const { kanji, words } = search(q);
  const known = totalKnown();
  const backTo = `/?q=${enc(q)}&type=${type}`;
  const tab = (id: string, label: string, count: number) =>
    `<a class="tab${type === id ? " on" : ""}" href="/?q=${enc(q)}&type=${id}">${label} ${count}</a>`;
  const alt = scriptAlt(q, type);
  const resultHead = `<div class="resulthead"><h2>Results for “${esc(q)}”${alt ? `<span class="alt">${alt}</span>` : ""}</h2><div class="tabs">${tab("all", "All", kanji.length + words.length)}${tab("kanji", "Kanji", kanji.length)}${tab("words", "Words", words.length)}</div></div>`;

  let list = "";
  if (type !== "words" && kanji.length) {
    list += `<div class="section-label"><h3>Kanji</h3><span class="sub">${kanji.length}</span></div>`;
    list += `<div class="kanji-grid">${kanji.map((k) => kanjiRow(k, q, known)).join("")}</div>`;
  }
  if (type !== "kanji" && words.length) {
    list += `<div class="section-label"><h3>Words</h3><span class="sub">${words.length}</span></div>`;
    list += words.map((w) => wordRow(w, backTo, q)).join("");
  }
  if (!list) list = `<div class="sub" style="padding:18px 0">Nothing found for “${esc(q)}”. Try another spelling or a shorter search.</div>`;

  const body = `${resultHead}
    <div class="grid">
      <div class="card" style="grid-column:span 12">${list}</div>
    </div>`;
  return page(`${q} – Kanji`, body);
}
