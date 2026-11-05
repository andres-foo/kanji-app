import { db } from "../db";
import { enc, esc, html, likeEsc, nullsLast } from "../html";
import { requestContext } from "../prefs";
import { pickReviewKanji } from "../review";
import type { Word } from "../types";
import { layout } from "./layout";
import { redesignLayout } from "./redesign-layout";
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

// the question side: the same shell as the kanji page, but only the kanji and the added example words
export function reviewPage(literal: string) {
  const k = db.query(`SELECT literal FROM kanjis WHERE literal = ?`).get(literal) as { literal: string } | null;
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = `/review/${enc(literal)}`;
  if (!k) return html(redesignLayout("Not found", `<div class="box empty">“${esc(literal)}” is not in the database.</div>`, { theme, back }), 404);
  const words = db.query(`SELECT * FROM examples WHERE COALESCE(added, 0) = 1 AND kanji LIKE ? ESCAPE '\\'`).all(`%${likeEsc(literal)}%`) as Word[];
  words.sort((a, b) => nullsLast(a.freq_wiki || null, b.freq_wiki || null) || (b.jlpt ?? 0) - (a.jlpt ?? 0));
  const chips = words.map((w) => `<span class="qword">${esc(splitKanjiMarker(w.kanji ?? "").text)}</span>`).join("");
  const body = `<div class="qpage"><div class="qcard"><div class="qkanji">${esc(k.literal)}</div>${chips ? `<div class="qwords">${chips}</div>` : ""}</div></div>`;
  const bar = `<a class="reviewbtn reveal" href="/kanji/${enc(k.literal)}?review=1" aria-keyshortcuts="Space"><kbd class="kbd">Space</kbd><span class="pad">A</span>Show answer</a>`;
  return html(redesignLayout(`Review – ${k.literal}`, body, { theme, back, bar, barClass: "qbar" }));
}
