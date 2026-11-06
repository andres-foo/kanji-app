import { Database } from "bun:sqlite";
import { DB_PATH } from "./config";

// Opened read-write: writes are the add/remove toggles, the kanji edit form and image upload/removal
// (IMAGES_DIR must be writable too).
export const db = new Database(DB_PATH, { readwrite: true });

// every search query and every normal kanji-page visit, newest last
db.run(`CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('search', 'kanji')),
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
)`);
db.run(`CREATE INDEX IF NOT EXISTS history_kind_id ON history (kind, id DESC)`);
// the old search-only table had no timestamp; the new history table replaces it
db.run(`DROP TABLE IF EXISTS search_history`);

// every kanji in the study list (added = 1)
export const addedCount = () =>
  (db.query(`SELECT COUNT(*) AS n FROM kanjis WHERE COALESCE(added, 0) = 1`).get() as { n: number }).n;

// every finished, non-component kanji in the study list
export const totalKnown = () =>
  (db.query(`SELECT COUNT(*) AS n FROM kanjis WHERE COALESCE(added, 0) = 1 AND is_component IS NULL AND COALESCE(unfinished, 0) = 0`).get() as { n: number }).n;
