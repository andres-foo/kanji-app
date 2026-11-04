import { Database } from "bun:sqlite";
import { DB_PATH } from "./config";

// Opened read-write: writes are the add/remove toggles, the kanji edit form and image upload/removal
// (IMAGES_DIR must be writable too).
export const db = new Database(DB_PATH, { readwrite: true });

// every kanji in the study list (added = 1)
export const addedCount = () =>
  (db.query(`SELECT COUNT(*) AS n FROM kanjis WHERE COALESCE(added, 0) = 1`).get() as { n: number }).n;
