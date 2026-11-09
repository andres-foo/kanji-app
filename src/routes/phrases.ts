import { db } from "../db";
import { likeEsc } from "../html";
import { phraseMorePerClick } from "../settings";
import { phraseListHtml, type Phrase } from "../views/design";

export function kanjiPhrases(literal: string, url: URL) {
  const offsetValue = Number(url.searchParams.get("offset") ?? 0);
  const offset = Number.isFinite(offsetValue) ? Math.max(0, Math.floor(offsetValue)) : 0;
  const limit = phraseMorePerClick();
  const like = `%${likeEsc(literal)}%`;
  const total = (db.query(`SELECT COUNT(*) AS n
    FROM phr.phrases
    WHERE japanese LIKE ? ESCAPE '\\' AND japanese_furigana IS NOT NULL`)
    .get(like) as { n: number }).n;
  const rows = db.query(`SELECT id, japanese, english, japanese_furigana
    FROM phr.phrases
    WHERE japanese LIKE ? ESCAPE '\\' AND japanese_furigana IS NOT NULL
    ORDER BY hardest_jlpt DESC, length(japanese), id
    LIMIT ? OFFSET ?`)
    .all(like, limit, offset) as Phrase[];
  const shown = rows.length;
  const remaining = Math.max(0, total - offset - shown);
  return new Response(JSON.stringify({
    html: phraseListHtml(rows),
    shown,
    total,
    remaining,
    batch: limit,
  }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
