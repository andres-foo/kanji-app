-- User database schema for word additions.
-- A row means the word is in the user's list.

CREATE TABLE IF NOT EXISTS user_word_added (
  word_id INTEGER PRIMARY KEY,
  added_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
