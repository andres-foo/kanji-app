import { esc, html } from "../html";
import { sameOrigin } from "../prefs";
import { saveReview, type ReviewResult } from "../review";
import { layout } from "../views/layout";

export async function reviewResult(req: Request, literal: string, result: ReviewResult) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  try {
    const found = saveReview(literal, result);
    if (!found) return html(layout("Not found", "", `<div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not save the review: ${esc((e as Error).message)}. Is the database file writable, and do the last_reviewed and due_date columns exist?</div>`), 500);
  }
  return new Response(null, { status: 303, headers: { location: "/review" } });
}
