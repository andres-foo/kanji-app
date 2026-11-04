import { db } from "./db";
import { masteryFor } from "./mastery";
import { scoreBounds, setting } from "./settings";

// the answer buttons shown on the answer page, in order (the id is the review type saved in review_history)
export const REVIEW_BUTTONS = [["bad", "Bad"], ["neutral", "Neutral"], ["good", "Good"], ["easy", "Easy"]] as const;
// the keyboard shortcut for each of those answers, in the same order (Space shows the answer)
export const REVIEW_KEYS = ["A", "S", "D", "F"] as const;
// the gamepad shoulder/trigger hint for each answer, in the same order (A shows the answer)
export const REVIEW_PAD = ["LT", "LB", "RB", "RT"] as const;

// The review queue split by due state: never scheduled at all (no due date), due today, or overdue.
// due_date is a YYYY-MM-DD text date, so comparing it to date('now', 'localtime') is a plain string comparison.
// An empty string is treated like NULL: the app never writes one, but a manual edit could.
export type DueCounts = { fresh: number; today: number; overdue: number };
export const EMPTY_DUE_COUNTS: DueCounts = { fresh: 0, today: 0, overdue: 0 }; // e.g. the due_date column does not exist yet

export const dueCounts = (): DueCounts => {
  try {
    const row = db.query(
      `SELECT
         SUM(CASE WHEN due_date IS NULL OR TRIM(due_date) = '' THEN 1 ELSE 0 END) AS fresh,
         SUM(CASE WHEN due_date = date('now', 'localtime') THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN due_date < date('now', 'localtime') THEN 1 ELSE 0 END) AS overdue
       FROM kanjis WHERE COALESCE(added, 0) = 1`,
    ).get() as Partial<DueCounts> | null;
    return { fresh: row?.fresh ?? 0, today: row?.today ?? 0, overdue: row?.overdue ?? 0 };
  } catch {
    return EMPTY_DUE_COUNTS; // never break every page because of a counter
  }
};

// kanji in the study list that can be reviewed now: never scheduled, due today, or overdue
export const dueCount = () => {
  const d = dueCounts();
  return d.fresh + d.today + d.overdue;
};

// the next kanji to review: added kanji that are due (due today or earlier, or never scheduled), the most overdue
// first, then the one reviewed longest ago (never reviewed first), then the lowest score, then random.
// Read-only: nothing is recorded until a result button is pressed.
export function pickReviewKanji(): string | null {
  const k = db.query(
    `SELECT literal FROM kanjis
     WHERE COALESCE(added, 0) = 1 AND (due_date IS NULL OR due_date <= date('now', 'localtime'))
     ORDER BY due_date ASC, last_reviewed ASC, COALESCE(score, 0) ASC, RANDOM() LIMIT 1`,
  ).get() as { literal: string } | null;
  return k?.literal ?? null;
}

// bad / neutral / good / easy: change the score by the amounts from the settings (default -3 / 0 / +1 / +2) within
// the bounds, schedule the next review from the new score's interval in mastery_levels (a bad answer is due again
// today), and record the review in review_history (score before and after, type as text). Rows are never deleted.
export const REVIEW_DELTA_KEYS = { bad: "review_delta_bad", neutral: "review_delta_neutral", good: "review_delta_good", easy: "review_delta_easy" } as const;
export type ReviewResult = keyof typeof REVIEW_DELTA_KEYS;

// apply one answer and return false when the kanji does not exist
export function saveReview(literal: string, result: ReviewResult): boolean {
  return db.transaction(() => {
    const k = db.query(`SELECT score FROM kanjis WHERE literal = ?`).get(literal) as { score: number | null } | null;
    if (!k) return false;
    const before = Math.round(Number(k.score ?? 0) || 0);
    const [lo, hi] = scoreBounds();
    const after = Math.min(hi, Math.max(lo, Math.round(before + setting(REVIEW_DELTA_KEYS[result]))));
    const days = result === "bad" ? 0 : masteryFor(after).interval_days;
    db.run(
      `UPDATE kanjis SET score = ?, last_reviewed = date('now', 'localtime'), due_date = date('now', 'localtime', ?) WHERE literal = ?`,
      [after, `+${days} days`, literal],
    );
    db.run(`INSERT INTO review_history (kanji, date, "before", "after", type) VALUES (?, datetime('now', 'localtime'), ?, ?, ?)`, [literal, before, after, result]);
    return true;
  })();
}
