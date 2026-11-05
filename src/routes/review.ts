import { sameOrigin } from "../prefs";
import { saveReview, type ReviewResult } from "../review";
import { messagePage } from "../views/message";

export async function reviewResult(req: Request, literal: string, result: ReviewResult) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  try {
    const found = saveReview(literal, result);
    if (!found) return messagePage("Kanji not found", `“${literal}” is not in the database.`, 404, { href: "/review", label: "Back to review" });
  } catch (e) {
    return messagePage("Review error", `Could not save the review: ${(e as Error).message}. Is the database file writable, and do the last_reviewed and due_date columns exist?`, 500);
  }
  return new Response(null, { status: 303, headers: { location: "/review" } });
}
