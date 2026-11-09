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
const readingsOf = (w: Word) =>
  String(w.kana ?? "")
    .split(";")
    .map((s) => stripAnnotations(s))
    .filter(Boolean);
const jlpt = (n: number | null | undefined) => Number(n ?? 0);
const common = (w: Word) => Number(w.is_common ?? 0);
const exactKeyword = (k: Kanji, qLower: string) =>
  String(k.keyword ?? "").split(";").map((s) => s.trim().toLowerCase()).includes(qLower);

const senseStart = /^(?:\([^)]*\)\s*)*\((\d+)\)(?:\s|$)/;
type DefinitionMatch = { sense: number; exact: boolean; atStart: boolean; part: number; wordsInPart: number };
// the first sense whose definition has the query at the start of an English word, plus whether
// the whole word matches ("test" exact) or only its prefix ("testing")
const definitionMatch = (meanings: unknown, q: string): DefinitionMatch | null => {
  let sense = 1;
  let part = 0;
  for (const raw of String(meanings ?? "").split(";")) {
    const s = raw.trim();
    if (!s) continue;
    part++;
    const marker = senseStart.exec(s);
    if (marker) sense = Number(marker[1]);
    const exact = wordExact(s, q);
    const starts = wordStart(s, q);
    if (exact || starts) {
      const normalized = cleanEnglish(s).replace(/^\s*to\s+/, "").trim().toLowerCase();
      return {
        sense,
        exact,
        atStart: normalized.startsWith(q.toLowerCase().trim()),
        part,
        wordsInPart: normalized.split(/\s+/).filter(Boolean).length,
      };
    }
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
  // `*` matches zero or more characters and `+` matches one or more.
  // Without either wildcard, keep the existing substring behaviour.
  const wordPat = (s: string) => {
    const escaped = likeEsc(s);
    if (!/[*+]/.test(escaped)) return `%${escaped}%`;
    return escaped.replace(/\+/g, "_%").replace(/\*/g, "%");
  };
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

    const readingClauses = kana.map(() => "reading LIKE ? ESCAPE '\\'").join(" OR ");
    words = db.query(`WITH matched(word_id) AS (
        SELECT word_id FROM ref.word_forms WHERE form LIKE ? ESCAPE '\\'
        UNION
        SELECT word_id FROM ref.word_readings WHERE ${readingClauses}
      )
      SELECT w.*, EXISTS (SELECT 1 FROM user_word_added u WHERE u.word_id = w.id) AS added
      FROM matched m JOIN ref.word_rows w ON w.id = m.word_id`).all(wordPat(q), ...kana.map(wordPat)) as Word[];

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
      const alternatives = String(w.kanji_alternative ?? "").split(";").map((s) => s.trim()).filter(Boolean);
      const kh = readingsOf(w).map(toHira);
      if (h === q) return 0;
      if (alternatives.includes(q)) return 1;
      if (kh.includes(qHira)) return 2;
      if (h.startsWith(q)) return 3;
      if (alternatives.some((a) => a.startsWith(q))) return 4;
      if (kh.some((r) => r.startsWith(qHira))) return 5;
      if (h.includes(q)) return 6;
      if (alternatives.some((a) => a.includes(q))) return 7;
      if (kh.some((r) => r.includes(qHira))) return 8;
      return 9;
    };
    words.sort((a, b) =>
      wordRank(a) - wordRank(b) ||
      common(b) - common(a) ||
      jlpt(b.jlpt) - jlpt(a.jlpt) ||
      nullsLast(a.id, b.id));
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

    type SenseWord = Word & { sense_no: number; gloss: string };
    const senseRows = db.query(`SELECT w.*, EXISTS (SELECT 1 FROM user_word_added u WHERE u.word_id = w.id) AS added,
        s.sense_no AS sense_no, s.gloss AS gloss
      FROM ref.word_senses s
      JOIN ref.word_rows w ON w.id = s.word_id
      WHERE s.gloss LIKE ? ESCAPE '\\'`).all(pat(q)) as SenseWord[];
    const bestByWord = new Map<number, { w: Word; match: DefinitionMatch; sense: number }>();
    const wordScore = (h: { match: DefinitionMatch; sense: number }) =>
      (h.match.exact ? 0 : 20) + (h.match.atStart ? 0 : 10) +
      h.match.part / 100 + h.sense / 1000 + (h.match.wordsInPart - 1) * 0.5;
    for (const row of senseRows) {
      const match = definitionMatch(row.gloss, q);
      if (!match) continue;
      const candidate = { w: row as Word, match, sense: row.sense_no };
      const previous = bestByWord.get(row.id);
      if (!previous || wordScore(candidate) < wordScore(previous)) {
        bestByWord.set(row.id, candidate);
      }
    }
    const wordTier = (h: { match: DefinitionMatch }) =>
      h.match.exact ? (h.match.atStart ? 0 : 1) : (h.match.atStart ? 2 : 3);
    const wordFine = (h: { match: DefinitionMatch; sense: number }) =>
      h.sense * 0.1 + h.match.part / 100 + (h.match.wordsInPart - 1) * 0.5;
    const whits = [...bestByWord.values()];
    whits.sort((a, b) =>
      wordTier(a) - wordTier(b) ||
      common(b.w) - common(a.w) ||
      wordFine(a) - wordFine(b) ||
      jlpt(b.w.jlpt) - jlpt(a.w.jlpt) ||
      nullsLast(a.w.id, b.w.id));
    words = whits.map((h) => h.w);
  }

  return { kanji, words };
}
