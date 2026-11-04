import { db } from "./db";

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
