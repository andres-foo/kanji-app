import { totalKnown } from "../db";
import { enc, esc, highlight, html, toKata } from "../html";
import { romajiToHiragana } from "../romaji";
import { search, shortQuery } from "../search";
import type { Kanji, Word } from "../types";
import { layout } from "./layout";
import { jlptBadge, kankenBadge, keywordText, meaningGroups, meaningsText, readingList, splitKanjiMarker } from "./shared";

const readingsRow = (k: Kanji, q: string) => {
  const on = readingList(k.onReadings);
  const kun = readingList(k.kunReadings);
  if (!on && !kun) return "";
  const part = (label: string, value: string) =>
    value ? `<span><span class="rlab">${label}</span>${highlight(value, q)}</span>` : "";
  return `<span class="readings">${part("On", on)}${part("Kun", kun)}</span>`;
};

const kanjiRow = (k: Kanji, q: string, total: number) => {
  const unfinished = k.added === 1 && k.unfinished === 1;
  return `
<div class="r${unfinished ? " unfinished" : k.added === 1 ? " in" : ""}">
<a class="rklink" href="/kanji/${enc(k.literal)}?q=${enc(q)}" aria-label="Open ${esc(k.literal)}"><span class="rk k">${esc(k.literal)}</span></a>
<span class="rm">${k.keyword ? `<span class="kw">${highlight(keywordText(k.keyword), q)}</span>` : ""}<span class="mean">${highlight(meaningsText(k.meanings), q)}</span>${readingsRow(k, q)}</span>
<span class="badges">${unfinished ? `<span class="sr">Unfinished</span>` : k.added === 1 ? `<span class="sr">In your study list</span>` : ""}${jlptBadge(k, total)}${kankenBadge(k, total)}</span></div>`;
};

const wordRow = (w: Word, back: string, q: string) => {
  const inList = w.added === 1;
  const { text: kanji, marker } = w.kanji ? splitKanjiMarker(w.kanji) : { text: "", marker: "" };
  const word = w.kanji
    ? `${kanji ? `<a class="wordlink" href="/?q=${enc(kanji)}" aria-label="Search for ${esc(kanji)}">${highlight(kanji, q)}</a>` : ""}${marker ? `<span class="kmarker">${esc(marker)}</span>` : ""}`
    : highlight(w.kana, q);
  return `
<div class="w${inList ? " in" : ""}" id="w${w.id}">
<div class="wtop">
<span class="k wk">${word}${w.kanji && w.kana ? `<span class="kana">「${highlight(w.kana, q)}」</span>` : ""}${w.kanji_alternative ? `<span class="alt">also ${highlight(w.kanji_alternative, q)}</span>` : ""}</span>
<span class="badges">${inList ? `<span class="sr">In your study list</span>` : ""}${w.jlpt ? `<span class="b">N${esc(w.jlpt)}</span>` : ""}${w.freq_wiki ? `<span class="b">#${esc(w.freq_wiki)}</span>` : ""}</span>
<form method="post" action="/words/${w.id}/toggle"><input type="hidden" name="back" value="${esc(back)}">
<button class="btn ${inList ? "rem" : "add"}" type="submit">${inList ? "Remove" : "Add"}</button></form>
</div>
<div class="wm">${meaningGroups(w.meanings).map((m) => `<span class="sense">${highlight(m, q)}</span>`).join("")}</div>
</div>`;
};

function suggestions(q: string, type: string) {
  const hira = romajiToHiragana(q);
  if (!hira) return "";
  const link = (label: string, tag: string, text: string) => shortQuery(text) ? "" :
    `<a class="sug" href="/?q=${enc(text)}&type=${type}"><span class="tag k">${tag}</span><span>${label}</span><span class="to k">${esc(text)}</span></a>`;
  const links = `${link("Search in hiragana", "あ", hira)}${link("Search in katakana", "ア", toKata(hira))}`;
  return links ? `<div class="sugs">${links}</div>` : "";
}

export function home(url: URL) {
  const raw = url.searchParams.get("q");
  const q = (raw ?? "").trim().slice(0, 100);
  const t = url.searchParams.get("type");
  const type = t === "kanji" || t === "words" ? t : "all";
  if (!q) return html(layout("Kanji", "", `<div class="box empty">${raw === null ? "Search by kanji, keyword, meaning, reading, or romaji." : "Enter at least two characters to search."}</div>`));
  if (shortQuery(q)) return html(layout("Search", q, `<div class="box empty">Enter at least two characters to search.</div>`));

  const { kanji, words } = search(q);
  const back = `/?q=${enc(q)}&type=${type}`;
  const pill = (id: string, label: string) =>
    `<a class="pill${type === id ? " on" : ""}" href="/?q=${enc(q)}&type=${id}">${label}</a>`;
  let body = suggestions(q, type);
  body += `<div class="pills">${pill("all", `All ${kanji.length + words.length}`)}${pill("kanji", `Kanji ${kanji.length}`)}${pill("words", `Words ${words.length}`)}</div>`;
  if (type !== "words" && kanji.length)
    body += `<section><h2>Kanji</h2><div class="box">${(() => { const total = totalKnown(); return kanji.map((k) => kanjiRow(k, q, total)).join(""); })()}</div></section>`;
  if (type !== "kanji" && words.length)
    body += `<section><h2>Words</h2><div class="box">${words.map((w) => wordRow(w, back, q)).join("")}</div></section>`;
  if (!kanji.length && !words.length) body += `<div class="box empty">Nothing found for “${esc(q)}”. Try another spelling or a shorter search.</div>`;
  return html(layout(`${q} – Kanji`, q, body));
}
