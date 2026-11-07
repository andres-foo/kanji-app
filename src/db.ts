import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { DB_PATH, PHRASE_DB_PATH, REFERENCE_DB_PATH } from "./config";

// Bun's ATTACH cannot request SQLite's URI read-only mode. Make the reference
// files themselves read-only so the running app cannot modify them. Custom
// kanji and reference updates are done outside the app, after clearing the bit.
for (const path of [REFERENCE_DB_PATH, PHRASE_DB_PATH]) {
  try {
    chmodSync(path, 0o444);
  } catch (e) {
    console.error(`Could not make ${path} read-only:`, e);
  }
}

// The app's main database is the user database. Reference words/kanji and
// example phrases are attached reference data.
export const db = new Database(DB_PATH, { readwrite: true });

db.run("ATTACH DATABASE ? AS ref", [REFERENCE_DB_PATH]);
db.run("ATTACH DATABASE ? AS phr", [PHRASE_DB_PATH]);

db.run(`CREATE TEMP VIEW IF NOT EXISTS kanjis AS
  SELECT k.literal, k.meanings, k.onReadings, k.kunReadings, k.strokes,
         k.jlpt, k.frequency, k.grade, u.components, k.other_forms,
         k.kanken, u.story, u.added, u.score, u.added_at, u.unfinished,
         u.is_component, u.component_group, u.related, k.low_priority,
         u.keyword, u.last_reviewed, u.due_date
  FROM ref.kanjis k
  LEFT JOIN user_kanjis u ON u.literal = k.literal`);

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
