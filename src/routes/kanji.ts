import { db } from "../db";
import { sameOrigin, safeBack } from "../prefs";
import { startScore } from "../settings";
import { messagePage } from "../views/message";

// flip examples.added between 0 and 1, then go back to where the user was
export async function toggleWord(req: Request, id: number) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  try {
    db.run(`UPDATE examples SET added = CASE WHEN COALESCE(added, 0) = 1 THEN 0 ELSE 1 END WHERE id = ?`, [id]);
  } catch (e) {
    return messagePage("Could not update word", `Could not update the word: ${(e as Error).message}. Is the database file writable?`, 500);
  }
  return new Response(null, { status: 303, headers: { location: `${back}#w${id}` } });
}

// flip kanjis.added between 0 and 1 (a newly added kanji starts out unfinished), then go back to the kanji page
export async function toggleKanji(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  try {
    db.run(
      `UPDATE kanjis
       SET added = CASE WHEN COALESCE(added, 0) = 1 THEN 0 ELSE 1 END,
           unfinished = CASE WHEN COALESCE(added, 0) = 1 THEN 0 ELSE 1 END,
           score = CASE WHEN COALESCE(added, 0) = 1 THEN score ELSE ? END,
           due_date = CASE WHEN COALESCE(added, 0) = 1 THEN due_date ELSE NULL END,
           last_reviewed = CASE WHEN COALESCE(added, 0) = 1 THEN last_reviewed ELSE NULL END
       WHERE literal = ?`,
      [startScore(), literal],
    );
  } catch (e) {
    return messagePage("Could not update kanji", `Could not update the kanji: ${(e as Error).message}. Is the database file writable?`, 500);
  }
  return new Response(null, { status: 303, headers: { location: back } });
}

// save the edit form: text fields (empty -> NULL) and the checkboxes (checked -> 1, unchecked -> 0).
// Ticking "Added" on a kanji that was not added starts it from scratch (starting score, due now); unticking it keeps its score.
export async function updateKanji(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const text = (name: string) => String(form.get(name) ?? "").replace(/\r\n?/g, "\n").trim() || null;
  const flag = (name: string) => (form.get(name) ? 1 : 0);
  const added = flag("added");
  try {
    // the CASE expressions see the old row, so they can tell that the kanji is being added right now
    const result = db.run(
      `UPDATE kanjis
       SET keyword = ?, components = ?, other_forms = ?, related = ?, story = ?, unfinished = ?, is_component = ?,
           score = CASE WHEN COALESCE(added, 0) = 0 AND ? = 1 THEN ? ELSE score END,
           due_date = CASE WHEN COALESCE(added, 0) = 0 AND ? = 1 THEN NULL ELSE due_date END,
           last_reviewed = CASE WHEN COALESCE(added, 0) = 0 AND ? = 1 THEN NULL ELSE last_reviewed END,
           added = ?
       WHERE literal = ?`,
      [text("keyword"), text("components"), text("other_forms"), text("related"), text("story"), flag("unfinished"), flag("is_component"), added, startScore(), added, added, added, literal],
    );
    if (!result.changes) return messagePage("Kanji not found", `“${literal}” is not in the database.`, 404);
  } catch (e) {
    return messagePage("Could not update kanji", `Could not update the kanji: ${(e as Error).message}. Is the database file writable?`, 500);
  }
  return new Response(null, { status: 303, headers: { location: back } });
}
