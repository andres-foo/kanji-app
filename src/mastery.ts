import { db } from "./db";

export const MAX_SCORE = 10;
export const MIN_SCORE = -3; // the bottom "Weak" levels sit below New (0)

export type Mastery = { score: number; label: string; interval_days: number };
const MASTERY_DEFAULTS: Mastery[] = [
  { score: -3, label: "Weak", interval_days: 1 },
  { score: -2, label: "Weak", interval_days: 1 },
  { score: -1, label: "Weak", interval_days: 1 },
  { score: 0, label: "New", interval_days: 1 },
  { score: 1, label: "Learning", interval_days: 1 },
  { score: 2, label: "Learning", interval_days: 2 },
  { score: 3, label: "Learning", interval_days: 3 },
  { score: 4, label: "Familiar", interval_days: 4 },
  { score: 5, label: "Familiar", interval_days: 6 },
  { score: 6, label: "Familiar", interval_days: 8 },
  { score: 7, label: "Strong", interval_days: 12 },
  { score: 8, label: "Strong", interval_days: 16 },
  { score: 9, label: "Strong", interval_days: 20 },
  { score: 10, label: "Mastered", interval_days: 25 },
];

// A missing row, an invalid row or a missing table falls back to the built-in default for that score,
// so a review never fails because of it.
export function masteryLevels(): Mastery[] {
  const levels = new Map(MASTERY_DEFAULTS.map((m) => [m.score, m]));
  try {
    for (const r of db.query(`SELECT score, label, interval_days FROM mastery_levels`).all() as Mastery[]) {
      const score = Number(r.score);
      const days = Math.floor(Number(r.interval_days));
      if (Number.isInteger(score) && score >= MIN_SCORE && score <= MAX_SCORE && String(r.label ?? "").trim() && days >= 1) {
        levels.set(score, { score, label: String(r.label).trim(), interval_days: days });
      }
    }
  } catch {
    // table missing: the defaults above are used
  }
  return [...levels.values()].sort((a, b) => a.score - b.score);
}
export const masteryFor = (score: number): Mastery => masteryLevels().find((m) => m.score === score) ?? MASTERY_DEFAULTS[0];
