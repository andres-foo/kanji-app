import { db } from "../db";
import { enc, esc, html, likeEsc, nullsLast } from "../html";
import { pickReviewKanji } from "../review";
import type { Word } from "../types";
import { layout } from "./layout";
import { splitKanjiMarker } from "./shared";

// /review: only chooses the next kanji and redirects to its own page; nothing is recorded until a result button is pressed there
export function reviewNext() {
  try {
    const literal = pickReviewKanji();
    if (!literal) {
      const added = (db.query(`SELECT COUNT(*) AS n FROM kanjis WHERE COALESCE(added, 0) = 1`).get() as { n: number }).n;
      if (!added) return html(layout("Review – Kanji", "", `<div class="box empty">No kanji in your list to review yet.</div>`));
      const next = db.query(
        `SELECT due_date, COUNT(*) AS n FROM kanjis WHERE COALESCE(added, 0) = 1 AND due_date > date('now', 'localtime')
         GROUP BY due_date ORDER BY due_date LIMIT 1`,
      ).get() as { due_date: string; n: number } | null;
      const when = next ? `<br>Next up: ${next.n} kanji due on ${esc(next.due_date)}.` : "";
      return html(layout("Review – Kanji", "", `<div class="box empty">Nothing to review right now.${when}</div>`));
    }
    return new Response(null, { status: 303, headers: { location: `/review/${enc(literal)}` } });
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not choose a kanji to review: ${esc((e as Error).message)}. Did you add the last_reviewed and due_date columns?</div>`), 500);
  }
}

// the question side: just the kanji and the added example words that contain it
export function reviewPage(literal: string) {
  const k = db.query(`SELECT literal FROM kanjis WHERE literal = ?`).get(literal) as { literal: string } | null;
  if (!k) return html(layout("Not found", "", `<div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);
  const words = db.query(`SELECT * FROM examples WHERE COALESCE(added, 0) = 1 AND kanji LIKE ? ESCAPE '\\'`).all(`%${likeEsc(literal)}%`) as Word[];
  words.sort((a, b) => nullsLast(a.freq_wiki || null, b.freq_wiki || null) || (b.jlpt ?? 0) - (a.jlpt ?? 0));
  const list = words.map((w) => `<span class="rvw k">${esc(splitKanjiMarker(w.kanji ?? "").text)}</span>`).join("");
  const body = `<div class="kanji-card rv"><div class="rvbig k">${esc(k.literal)}</div>${list ? `<div class="rvwords">${list}</div>` : ""}</div>`;
  const bar = `<a class="reviewbtn" href="/kanji/${enc(k.literal)}?review=1" aria-keyshortcuts="Space"><kbd class="kbd">Space</kbd><span class="pad">A</span>Show answer</a>`;
  return html(layout("Review – Kanji", "", body, "", bar));
}
