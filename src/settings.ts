import { db } from "./db";
import { MAX_SCORE, MIN_SCORE } from "./mastery";

// values are stored as text; a missing row, an unreadable table or a non-numeric value falls back to the default
const SETTING_DEFAULTS = {
  review_score_ceiling: 10, // a kanji's score never goes above this (the scale itself is -3 to 10)
  review_score_floor: -3, // ... or below this
  review_score_start: 0, // score given to a kanji the moment it is added, and the value "reset scores" sets
  review_delta_bad: -3,
  review_delta_neutral: 0,
  review_delta_good: 1,
  review_delta_easy: 2,
  history_limit: 50, // entries shown in each History column
  word_results_per_page: 20, // word results shown per search page
  phrase_results_per_kanji: 5, // example phrases shown initially per kanji page
} as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;
export const WORD_RESULTS_MAX = 200;
export const PHRASE_RESULTS_MAX = 10;

export function setting(key: SettingKey): number {
  try {
    const row = db.query(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string | null } | null;
    const text = String(row?.value ?? "").trim();
    const n = Number(text);
    return text !== "" && Number.isFinite(n) ? n : SETTING_DEFAULTS[key];
  } catch {
    return SETTING_DEFAULTS[key];
  }
}

export const wordResultsPerPage = () => Math.max(1, Math.min(WORD_RESULTS_MAX, Math.round(setting("word_results_per_page"))));
export const phrasesPerKanji = () => Math.max(1, Math.min(PHRASE_RESULTS_MAX, Math.round(setting("phrase_results_per_kanji"))));

// lowest and highest score allowed: the settings, but never outside the -3 to 10 scale
export function scoreBounds(): [number, number] {  const a = setting("review_score_floor");
  const b = setting("review_score_ceiling");
  return [Math.max(MIN_SCORE, Math.min(a, b)), Math.min(MAX_SCORE, Math.max(a, b))];
}
export const startScore = () => {
  const [lo, hi] = scoreBounds();
  return Math.min(hi, Math.max(lo, Math.round(setting("review_score_start"))));
};
