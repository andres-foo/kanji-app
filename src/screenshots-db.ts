import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCREENSHOTS_DB_PATH, SCREENSHOTS_DIR } from "./config";

mkdirSync(dirname(SCREENSHOTS_DB_PATH), { recursive: true });
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

export const shots = new Database(SCREENSHOTS_DB_PATH, { create: true, readwrite: true });
shots.run("PRAGMA journal_mode = WAL");
shots.run("PRAGMA busy_timeout = 3000");

shots.run(`CREATE TABLE IF NOT EXISTS screenshots (
  id       INTEGER PRIMARY KEY,
  file     TEXT NOT NULL,
  hash     TEXT NOT NULL,
  japanese TEXT NOT NULL DEFAULT '',
  english  TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  done     INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
)`);
const columns = shots.query(`PRAGMA table_info(screenshots)`).all() as { name: string }[];
if (!columns.some((column) => column.name === "position")) {
  shots.run(`ALTER TABLE screenshots ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
}
shots.run(`CREATE UNIQUE INDEX IF NOT EXISTS screenshots_hash ON screenshots(hash)`);
shots.run(`CREATE INDEX IF NOT EXISTS screenshots_done ON screenshots(done, id DESC)`);
