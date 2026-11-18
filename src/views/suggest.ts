import { db } from "../db";
import { enc, esc, likeEsc, nullsLast } from "../html";
import type { Kanji } from "../types";
import { keywordText } from "./shared";

type Row = Pick<Kanji, "literal" | "keyword" | "jlpt" | "frequency"> & { added: number };

const MAX_ROWS = 6;
// Ranking happens in JavaScript, so the SQL only has to hand back the plausible
// candidates: the most common kanji whose keyword contains the query.
const MAX_CANDIDATES = 400;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Keywords hold several synonyms separated by ";" and are often written as a phrase
// such as "day / sun / 24 hours", so a hit is ranked by how much of a synonym it
// covers: the whole synonym, its start, the start of a word inside it, then a loose
// substring. Anything that does not match at all is dropped.
const synonymRank = (keyword: string | null, needle: string) => {
  let rank = 9;
  for (const raw of String(keyword ?? "").split(";")) {
    const synonym = raw.trim().toLowerCase();
    if (!synonym) continue;
    if (synonym === needle) return 0;
    if (synonym.startsWith(needle)) { rank = Math.min(rank, 1); continue; }
    let wordStart = false;
    try {
      wordStart = new RegExp(`(^|[^a-z0-9])${escapeRegex(needle)}`).test(synonym);
    } catch {
      wordStart = false;
    }
    rank = Math.min(rank, wordStart ? 2 : 3);
  }
  return rank;
};

const rowHtml = (row: Row) => `<a class="sug-row" role="option" aria-selected="false" href="/kanji/${enc(row.literal)}">
  <span class="sug-tile">${esc(row.literal)}${row.added === 1 ? `<i class="sug-dot" aria-hidden="true"></i>` : ""}</span>
  <span class="sug-main"><b>${esc(keywordText(row.keyword))}</b></span>
  <span class="sug-meta">${row.jlpt ? `<span class="badge">N${row.jlpt}</span>` : ""}${row.frequency ? `<span class="sug-rk">#${row.frequency}</span>` : ""}</span>
</a>`;

// the rows for the nav search dropdown; the client adds the keyboard hint and the
// "see all results" link around them
export function suggestHtml(rawQuery: string) {
  const query = rawQuery.trim();
  if ([...query].length < 2) return `<div class="sug-list"></div>`;
  const needle = query.toLowerCase();
  const candidates = db.query(`SELECT literal, keyword, jlpt, frequency, COALESCE(added, 0) AS added
    FROM kanjis WHERE COALESCE(keyword, '') LIKE ? ESCAPE '\\'
    ORDER BY frequency IS NULL, frequency, literal
    LIMIT ?`).all(`%${likeEsc(query)}%`, MAX_CANDIDATES) as Row[];
  const rows = candidates
    .map((row) => ({ row, rank: synonymRank(row.keyword, needle) }))
    .filter((hit) => hit.rank < 9)
    .sort((a, b) =>
      a.rank - b.rank ||
      Number(b.row.jlpt ?? 0) - Number(a.row.jlpt ?? 0) ||
      nullsLast(a.row.frequency, b.row.frequency) ||
      a.row.literal.localeCompare(b.row.literal))
    .slice(0, MAX_ROWS)
    .map((hit) => rowHtml(hit.row));
  return `<div class="sug-list">${rows.join("")}</div>`;
}
