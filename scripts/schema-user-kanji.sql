-- Personal kanji state. Reference fields (meanings, readings, levels, etc.) stay in
-- reference.db; this table only holds hand-maintained and study data.
CREATE TABLE IF NOT EXISTS user_kanjis (
  literal TEXT PRIMARY KEY,
  components TEXT,
  related TEXT,
  story TEXT,
  keyword TEXT,
  added INTEGER,
  added_at TEXT,
  unfinished INTEGER,
  score INTEGER,
  last_reviewed TEXT,
  due_date TEXT,
  is_component INTEGER,
  component_group INTEGER
);

CREATE TABLE IF NOT EXISTS review_history (
  id INTEGER PRIMARY KEY,
  kanji TEXT NOT NULL,
  date TEXT NOT NULL,
  "before" INTEGER,
  "after" INTEGER,
  type TEXT
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('search', 'kanji')),
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS history_kind_id ON history(kind, id DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mastery_levels (
  score INTEGER PRIMARY KEY CHECK (score BETWEEN -3 AND 10),
  label TEXT NOT NULL,
  interval_days INTEGER NOT NULL CHECK (interval_days >= 1)
);
