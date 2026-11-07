-- Tatoeba example phrases and their generated furigana.
CREATE TABLE IF NOT EXISTS phrases (
  id INTEGER PRIMARY KEY,
  japanese TEXT NOT NULL,
  english TEXT NOT NULL,
  japanese_furigana TEXT,
  furigana_checked INTEGER NOT NULL DEFAULT 0 CHECK (furigana_checked IN (0, 1)),
  hardest_jlpt INTEGER NOT NULL DEFAULT 0 CHECK (hardest_jlpt BETWEEN 0 AND 5)
);
