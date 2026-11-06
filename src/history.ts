import { db } from "./db";
import { setting } from "./settings";

export const HISTORY_MAX = 500;

export type HistoryKind = "search" | "kanji";
export type HistoryKanji = { literal: string; added: number | null; unfinished: number | null };

export function historyLimit(): number {
  const n = Math.round(setting("history_limit"));
  return Number.isFinite(n) ? Math.max(1, Math.min(HISTORY_MAX, n)) : 50;
}

export function recordHistory(kind: HistoryKind, value: string) {
  const v = value.trim();
  if (!v) return;
  try {
    db.run(`INSERT INTO history (kind, value) VALUES (?, ?)`, [kind, v]);
  } catch (e) {
    // a history failure must never take down search or the kanji page
    console.error("Could not record history:", e);
  }
}

export function searchHistory(limit = historyLimit()): string[] {
  return (db.query(`SELECT value FROM history WHERE kind = 'search' GROUP BY value ORDER BY MAX(id) DESC LIMIT ?`).all(limit) as { value: string }[])
    .map((r) => r.value);
}

export function kanjiHistory(limit = historyLimit()): HistoryKanji[] {
  return db.query(`SELECT h.value AS literal, k.added, k.unfinished
    FROM (SELECT value, MAX(id) AS latest FROM history WHERE kind = 'kanji' GROUP BY value ORDER BY latest DESC LIMIT ?) h
    LEFT JOIN kanjis k ON k.literal = h.value
    ORDER BY h.latest DESC`).all(limit) as HistoryKanji[];
}
