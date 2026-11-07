-- Stable kanji reference data. Custom component kanji are kept here too, marked
-- with source = 'custom', so a future KANJIDIC2 refresh can preserve them.
CREATE TABLE IF NOT EXISTS kanjis (
  literal TEXT PRIMARY KEY,
  meanings TEXT NOT NULL,
  onReadings TEXT,
  kunReadings TEXT,
  strokes INTEGER,
  jlpt INTEGER,
  frequency INTEGER,
  grade INTEGER,
  kanken NUMERIC,
  other_forms TEXT,
  low_priority INTEGER,
  source TEXT NOT NULL CHECK (source IN ('kanjidic2', 'custom'))
);

CREATE INDEX IF NOT EXISTS kanjis_jlpt ON kanjis(jlpt);
CREATE INDEX IF NOT EXISTS kanjis_kanken ON kanjis(kanken);
CREATE INDEX IF NOT EXISTS kanjis_frequency ON kanjis(frequency);
