-- Reference database schema for JMdict words.
-- words.id is the JMdict ent_seq: stable and unique across imports.

CREATE TABLE words (
  id INTEGER PRIMARY KEY
);

CREATE TABLE word_jlpt (
  word_id INTEGER PRIMARY KEY REFERENCES words(id),
  jlpt INTEGER NOT NULL CHECK (jlpt BETWEEN 1 AND 5),
  source TEXT NOT NULL DEFAULT 'Tanos'
);

CREATE INDEX word_jlpt_level ON word_jlpt(jlpt);

CREATE TABLE word_forms (
  word_id INTEGER NOT NULL REFERENCES words(id),
  form TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0, 1)),
  info TEXT,
  PRIMARY KEY (word_id, form)
);

CREATE TABLE word_readings (
  word_id INTEGER NOT NULL REFERENCES words(id),
  reading TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0, 1)),
  info TEXT,
  no_kanji INTEGER NOT NULL DEFAULT 0 CHECK (no_kanji IN (0, 1)),
  restriction TEXT,
  PRIMARY KEY (word_id, reading)
);

CREATE TABLE word_senses (
  word_id INTEGER NOT NULL REFERENCES words(id),
  sense_no INTEGER NOT NULL,
  pos TEXT,
  misc TEXT,
  gloss TEXT NOT NULL,
  PRIMARY KEY (word_id, sense_no)
);

CREATE INDEX word_forms_form ON word_forms(form);
CREATE INDEX word_readings_reading ON word_readings(reading);
CREATE INDEX word_senses_word ON word_senses(word_id);

-- Example phrases live in their own database: data/phrases.db.

-- A single read-only row per word for the app's existing display/search shape.
-- `added` is intentionally not here: that belongs to user.db.
CREATE VIEW word_rows AS
SELECT
  w.id,
  COALESCE(
    (SELECT f.form FROM word_forms f WHERE f.word_id = w.id ORDER BY f.priority DESC, f.form LIMIT 1),
    (SELECT r.reading FROM word_readings r WHERE r.word_id = w.id ORDER BY r.priority DESC, r.reading LIMIT 1)
  ) AS kanji,
  (SELECT group_concat(reading, '; ')
     FROM (SELECT reading FROM word_readings WHERE word_id = w.id ORDER BY priority DESC, reading)) AS kana,
  (SELECT group_concat(gloss, '; ')
     FROM (SELECT gloss FROM word_senses WHERE word_id = w.id ORDER BY sense_no)) AS meanings,
  NULL AS freq_wiki,
  (SELECT jlpt FROM word_jlpt WHERE word_id = w.id) AS jlpt,
  (SELECT group_concat(form, '; ')
     FROM word_forms f
    WHERE f.word_id = w.id
      AND f.form != COALESCE(
        (SELECT f2.form FROM word_forms f2 WHERE f2.word_id = w.id ORDER BY f2.priority DESC, f2.form LIMIT 1),
        ''
      )) AS kanji_alternative,
  CASE WHEN EXISTS (SELECT 1 FROM word_forms f WHERE f.word_id = w.id) THEN 0 ELSE 1 END AS is_kana_only,
  CASE
    WHEN EXISTS (SELECT 1 FROM word_forms f WHERE f.word_id = w.id AND f.priority = 1)
      OR EXISTS (SELECT 1 FROM word_readings r WHERE r.word_id = w.id AND r.priority = 1)
    THEN 1 ELSE 0
  END AS is_common
FROM words w;
