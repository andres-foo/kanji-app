import { db } from "./db";
import { likeEsc, nullsLast, toHira, toKata } from "./html";
import type { Kanji, Word } from "./types";

// Search query rules shared by the router and the layout.
export const SEARCH_MIN = 2;
const singleCjk = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;
export const shortQuery = (q: string) => [...q].length < SEARCH_MIN && !singleCjk.test(q);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// parentheticals are examples, cross-references or parts of speech, not definitions; "(P)" is a
// priority marker, not a word. Dropping them keeps "test" from matching "to take (a test)".
const cleanEnglish = (s: unknown) => String(s ?? "").replace(/\([^)]*\)/g, " ");

// match the start of an English word, not an arbitrary substring: "test" matches testing/testify,
// but not latest/contest/detest, and "eat" matches eat/eating but not great/meat/defeat
const wordStart = (text: unknown, q: string) => {
  const hay = cleanEnglish(text).toLowerCase();
  const needle = q.toLowerCase().trim();
  if (!hay || !needle) return false;
  try {
    return new RegExp(`(^|[^a-z])${escapeRegex(needle)}`).test(hay);
  } catch {
    return false;
  }
};

const wordExact = (text: unknown, q: string) => {
  const hay = cleanEnglish(text).toLowerCase();
  const needle = q.toLowerCase().trim();
  if (!hay || !needle) return false;
  try {
    return new RegExp(`(^|[^a-z])${escapeRegex(needle)}([^a-z]|$)`).test(hay);
  } catch {
    return false;
  }
};

// strip trailing annotations such as "(P)", "(ateji)" or a combination of them
const stripAnnotations = (s: string) => s.replace(/\s*(?:\([^)]*\))+\s*$/g, "").trim();
const headword = (w: Word) => stripAnnotations(String(w.kanji ?? ""));
const kanaFirst = (w: Word) => stripAnnotations(String(w.kana ?? "").split(";")[0]);
const jlpt = (n: number | null | undefined) => Number(n ?? 0);
const exactKeyword = (k: Kanji, qLower: string) =>
  String(k.keyword ?? "").split(";").map((s) => s.trim().toLowerCase()).includes(qLower);

const senseStart = /^(?:\([^)]*\)\s*)*\((\d+)\)(?:\s|$)/;
type DefinitionMatch = { sense: number; exact: boolean };
// the first sense whose definition has the query at the start of an English word, plus whether
// the whole word matches ("test" exact) or only its prefix ("testing")
const definitionMatch = (meanings: unknown, q: string): DefinitionMatch | null => {
  let sense = 1;
  for (const part of String(meanings ?? "").split(";")) {
    const s = part.trim();
    if (!s) continue;
    const marker = senseStart.exec(s);
    if (marker) sense = Number(marker[1]);
    const exact = wordExact(s, q);
    if (exact || wordStart(s, q)) return { sense, exact };
  }
  return null;
};

const hasJapanese = (q: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(q);
const lowRank = (k: Kanji) => k.low_priority === 1 ? 1 : 0;

export function search(q: string) {
  const japanese = hasJapanese(q);
  const kana = [...new Set([toHira(q), toKata(q)])];
  const hasKana = /[\u3041-\u30ff]/.test(q);
  const lits = [...new Set(q.match(/\p{Script=Han}/gu) ?? [])].slice(0, 12);
  const pat = (s: string) => `%${likeEsc(s)}%`;
  const qLower = q.toLowerCase();
  const qHira = toHira(q);

  let kanji: Kanji[];
  let words: Word[];

  if (japanese) {
    // Japanese queries match literals, readings and word spellings only; English meanings and
    // cross-references are excluded, so a query like 受ける does not match a "(See 真に受ける)" note.
    const kc: string[] = [];
    const kp: string[] = [];
    if (lits.length) {
      kc.push(`literal IN (${lits.map(() => "?").join(",")})`);
      kp.push(...lits);
    }
    if (hasKana) {
      for (const v of kana) {
        kc.push(`REPLACE(REPLACE(COALESCE(onReadings, '') || ' ' || COALESCE(kunReadings, ''), '.', ''), '-', '') LIKE ? ESCAPE '\\'`);
        kp.push(pat(v));
      }
    }
    kanji = db.query(`SELECT * FROM kanjis WHERE ${kc.join(" OR ")}`).all(...kp) as Kanji[];

    const wc = [`kanji LIKE ? ESCAPE '\\'`];
    const wp = [pat(q)];
    for (const v of kana) {
      wc.push(`kana LIKE ? ESCAPE '\\'`);
      wp.push(pat(v));
    }
    wc.push(`kanji_alternative LIKE ? ESCAPE '\\'`);
    wp.push(pat(q));
    words = db.query(`SELECT * FROM examples WHERE ${wc.join(" OR ")}`).all(...wp) as Word[];

    const readingRank = (k: Kanji) => {
      const readings = `${k.onReadings ?? ""} ${k.kunReadings ?? ""}`.replace(/[.\-]/g, " ").split(/[\s、,;]+/).filter(Boolean).map(toHira);
      if (readings.includes(qHira)) return 0;
      if (readings.some((r) => r.startsWith(qHira))) return 1;
      if (readings.some((r) => r.includes(qHira))) return 2;
      return 3;
    };
    const kanjiRank = (k: Kanji) => k.literal === q ? 0 : lits.includes(k.literal) ? 1 : 2 + readingRank(k);
    kanji.sort((a, b) =>
      lowRank(a) - lowRank(b) ||
      kanjiRank(a) - kanjiRank(b) ||
      jlpt(b.jlpt) - jlpt(a.jlpt) ||
      nullsLast(a.frequency, b.frequency));

    const wordRank = (w: Word) => {
      const h = headword(w);
      const k = kanaFirst(w);
      const kh = toHira(k);
      if (h === q || (kh && kh === qHira)) return 0;
      if (h.startsWith(q)) return 1;
      if (kh && kh.startsWith(qHira)) return 2;
      if (h.includes(q)) return 3;
      if (kh && kh.includes(qHira)) return 4;
      if (String(w.kanji_alternative ?? "").includes(q)) return 5;
      return 6;
    };
    words.sort((a, b) =>
      wordRank(a) - wordRank(b) ||
      jlpt(b.jlpt) - jlpt(a.jlpt) ||
      nullsLast(a.freq_wiki, b.freq_wiki));
  } else {
    // English queries match the start of a definition word; suffix matches such as latest/contest,
    // great/meat or detest/intestines are discarded. Earlier senses win over obscure later senses.
    const kc = [`CAST(meanings AS TEXT) LIKE ? ESCAPE '\\'`, `CAST(keyword AS TEXT) LIKE ? ESCAPE '\\'`];
    const kp = [pat(q), pat(q)];
    const khits = (db.query(`SELECT * FROM kanjis WHERE ${kc.join(" OR ")}`).all(...kp) as Kanji[])
      .map((k) => ({ k, exact: exactKeyword(k, qLower), keyStart: wordStart(k.keyword, q), match: definitionMatch(k.meanings, q) }))
      .filter((h) => h.exact || h.keyStart || h.match !== null);
    const score = (h: { exact: boolean; keyStart: boolean; match: DefinitionMatch | null }) =>
      h.exact ? 0 : h.keyStart ? 1 : h.match !== null ? 2 + (h.match.exact ? 0 : 1) + h.match.sense / 1000 : 99;
    khits.sort((a, b) =>
      lowRank(a.k) - lowRank(b.k) ||
      score(a) - score(b) ||
      jlpt(b.k.jlpt) - jlpt(a.k.jlpt) ||
      nullsLast(a.k.frequency, b.k.frequency));
    kanji = khits.map((h) => h.k);

    const wc = [`CAST(meanings AS TEXT) LIKE ? ESCAPE '\\'`];
    const whits = (db.query(`SELECT * FROM examples WHERE ${wc.join(" OR ")}`).all(pat(q)) as Word[])
      .map((w) => ({ w, match: definitionMatch(w.meanings, q) }))
      .filter((h) => h.match !== null);
    const wordScore = (h: { match: DefinitionMatch | null }) =>
      h.match === null ? 999 : (h.match.exact ? 0 : 100) + h.match.sense;
    whits.sort((a, b) =>
      wordScore(a) - wordScore(b) ||
      jlpt(b.w.jlpt) - jlpt(a.w.jlpt) ||
      nullsLast(a.w.freq_wiki, b.w.freq_wiki));
    words = whits.map((h) => h.w);
  }

  return { kanji, words };
}
