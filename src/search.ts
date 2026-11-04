import { db } from "./db";
import { likeEsc, nullsLast, toHira, toKata } from "./html";
import type { Kanji, Word } from "./types";

// Search query rules shared by the router and the layout.
export const SEARCH_MIN = 2;
const singleCjk = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;
export const shortQuery = (q: string) => [...q].length < SEARCH_MIN && !singleCjk.test(q);

export function search(q: string) {
  const kana = [...new Set([toHira(q), toKata(q)])];
  const hasKana = /[\u3041-\u30ff]/.test(q);
  const lits = [...new Set(q.match(/\p{Script=Han}/gu) ?? [])].slice(0, 12);
  const pat = (s: string) => `%${likeEsc(s)}%`;

  // kanji: literal, keyword, meanings, on/kun readings (ignoring "." and "-" okurigana marks)
  const kc: string[] = [`CAST(meanings AS TEXT) LIKE ? ESCAPE '\\'`, `CAST(keyword AS TEXT) LIKE ? ESCAPE '\\'`];
  const kp: string[] = [pat(q), pat(q)];
  if (lits.length) { kc.push(`literal IN (${lits.map(() => "?").join(",")})`); kp.push(...lits); }
  if (hasKana) {
    for (const v of kana) {
      kc.push(`REPLACE(REPLACE(COALESCE(onReadings,'') || ' ' || COALESCE(kunReadings,''), '.', ''), '-', '') LIKE ? ESCAPE '\\'`);
      kp.push(pat(v));
    }
  }
  const kanji = (db.query(`SELECT * FROM kanjis WHERE ${kc.join(" OR ")}`).all(...kp) as Kanji[])
    .sort((a, b) =>
      Number(lits.includes(b.literal)) - Number(lits.includes(a.literal)) ||
      (b.jlpt ?? 0) - (a.jlpt ?? 0) ||
      nullsLast(a.frequency, b.frequency));

  // words: kanji, kana, meanings (+ alternative spellings)
  const wc = [`kanji LIKE ? ESCAPE '\\'`, `CAST(meanings AS TEXT) LIKE ? ESCAPE '\\'`, `kanji_alternative LIKE ? ESCAPE '\\'`];
  const wp = [pat(q), pat(q), pat(q)];
  for (const v of kana) { wc.push(`kana LIKE ? ESCAPE '\\'`); wp.push(pat(v)); }
  const exact = (w: Word) => w.kanji === q || (w.kana !== null && kana.includes(w.kana));
  const words = (db.query(`SELECT * FROM examples WHERE ${wc.join(" OR ")}`).all(...wp) as Word[])
    .sort((a, b) => Number(exact(b)) - Number(exact(a)) || nullsLast(a.freq_wiki, b.freq_wiki));

  return { kanji, words };
}
