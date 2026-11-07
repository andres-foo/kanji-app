import { db } from "../db";
import { enc } from "../html";
import { sameOrigin, safeBack } from "../prefs";
import { startScore } from "../settings";
import { messagePage } from "../views/message";

// toggle a word in user_word_added, then go back to where the user was
export async function toggleWord(req: Request, id: number) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  try {
    const exists = db.query(`SELECT 1 FROM user_word_added WHERE word_id = ?`).get(id);
    if (exists) {
      db.run(`DELETE FROM user_word_added WHERE word_id = ?`, [id]);
    } else {
      db.run(`INSERT OR IGNORE INTO user_word_added (word_id) VALUES (?)`, [id]);
    }
  } catch (e) {
    return messagePage("Could not update word", `Could not update the word: ${(e as Error).message}. Is the database file writable?`, 500);
  }
  return new Response(null, { status: 303, headers: { location: `${back}#w${id}` } });
}

// flip user_kanjis.added between 0 and 1 (a newly added kanji starts out unfinished), then go back to the kanji page
export async function toggleKanji(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  try {
    const exists = db.query(`SELECT 1 FROM ref.kanjis WHERE literal = ?`).get(literal);
    if (!exists) return messagePage("Kanji not found", `“${literal}” is not in the database.`, 404);
    const row = db.query(`SELECT added FROM user_kanjis WHERE literal = ?`).get(literal) as { added: number | null } | null;
    const added = Number(row?.added ?? 0) === 1;
    if (added) {
      db.run(`UPDATE user_kanjis SET added = 0, unfinished = 0 WHERE literal = ?`, [literal]);
    } else {
      db.run(
        `INSERT INTO user_kanjis (literal, added, unfinished, score, due_date, last_reviewed)
         VALUES (?, 1, 1, ?, NULL, NULL)
         ON CONFLICT(literal) DO UPDATE SET
           added = 1, unfinished = 1, score = excluded.score,
           due_date = NULL, last_reviewed = NULL`,
        [literal, startScore()],
      );
    }
  } catch (e) {
    return messagePage("Could not update kanji", `Could not update the kanji: ${(e as Error).message}. Is the database file writable?`, 500, { href: `/kanji/${enc(literal)}`, label: "Back to kanji" });
  }
  return new Response(null, { status: 303, headers: { location: back } });
}

// save the edit form: user-owned text fields (empty -> NULL) and checkboxes. Reference
// fields such as meanings, readings and other forms are never written here.
// Ticking "Added" on a kanji that was not added starts it from scratch (starting score,
// due now); unticking it keeps its score.
export async function updateKanji(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const text = (name: string) => String(form.get(name) ?? "").replace(/\r\n?/g, "\n").trim() || null;
  const flag = (name: string) => (form.get(name) ? 1 : 0);
  const added = flag("added");
  try {
    const exists = db.query(`SELECT 1 FROM ref.kanjis WHERE literal = ?`).get(literal);
    if (!exists) return messagePage("Kanji not found", `“${literal}” is not in the database.`, 404);
    const current = db.query(`SELECT added, score, due_date, last_reviewed, is_component, component_group FROM user_kanjis WHERE literal = ?`).get(literal) as {
      added: number | null; score: number | null; due_date: string | null; last_reviewed: string | null;
      is_component: number | null; component_group: number | null;
    } | null;
    const wasAdded = Number(current?.added ?? 0) === 1;
    const starting = !wasAdded && added === 1;
    const score = starting ? startScore() : Number(current?.score ?? 0);
    const dueDate = starting ? null : current?.due_date ?? null;
    const lastReviewed = starting ? null : current?.last_reviewed ?? null;
    const isComponent = flag("is_component");
    const componentGroup = isComponent === 1 && Number(current?.component_group ?? 0) > 0
      ? Number(current!.component_group)
      : null;
    db.run(
      `INSERT INTO user_kanjis
         (literal, keyword, components, related, story, unfinished, is_component, component_group,
          score, due_date, last_reviewed, added, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               CASE WHEN ? = 1 THEN datetime('now', 'localtime') ELSE NULL END)
       ON CONFLICT(literal) DO UPDATE SET
         keyword = excluded.keyword,
         components = excluded.components,
         related = excluded.related,
         story = excluded.story,
         unfinished = excluded.unfinished,
         is_component = excluded.is_component,
         component_group = excluded.component_group,
         score = excluded.score,
         due_date = excluded.due_date,
         last_reviewed = excluded.last_reviewed,
         added = excluded.added`,
      [literal, text("keyword"), text("components"), text("related"), text("story"),
       flag("unfinished"), isComponent, componentGroup, score, dueDate, lastReviewed, added, added],
    );
  } catch (e) {
    return messagePage("Could not update kanji", `Could not update the kanji: ${(e as Error).message}. Is the database file writable?`, 500, { href: `/kanji/${enc(literal)}?edit=1`, label: "Back to kanji" });
  }
  return new Response(null, { status: 303, headers: { location: back } });
}
