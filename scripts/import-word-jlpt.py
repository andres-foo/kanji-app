"""Import Tanos JLPT vocabulary levels into data/reference.db.

Matching is by exact written form plus normalized reading. A word with
conflicting Tanos levels is left out and reported as ambiguous.
"""

from __future__ import annotations

import argparse
import csv
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "data" / "reference.db"
DEFAULT_CSV = ROOT / "sources" / "JLPT_vocab_ALL.csv"


def clean(value: str | None) -> str:
    text = (value or "").strip()
    return re.sub(r"(?:\s*[\(（][^\)）]*[\)）])+\s*$", "", text).strip()


def to_hiragana(value: str) -> str:
    return "".join(
        chr(ord(ch) - 0x60) if "\u30a1" <= ch <= "\u30f6" else ch
        for ch in value
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    args = parser.parse_args()
    if not args.csv.exists():
        raise SystemExit(f"Missing {args.csv}")
    if not REFERENCE.exists():
        raise SystemExit(f"Missing {REFERENCE}")

    ref = sqlite3.connect(REFERENCE)
    ref.execute("PRAGMA foreign_keys = ON")
    ref.executescript(
        """
        CREATE TABLE IF NOT EXISTS word_jlpt (
          word_id INTEGER PRIMARY KEY REFERENCES words(id),
          jlpt INTEGER NOT NULL CHECK (jlpt BETWEEN 1 AND 5),
          source TEXT NOT NULL DEFAULT 'Tanos'
        );
        CREATE INDEX IF NOT EXISTS word_jlpt_level ON word_jlpt(jlpt);
        """
    )

    by_form_reading: dict[tuple[str, str], set[int]] = defaultdict(set)
    for word_id, form, reading in ref.execute(
        "SELECT f.word_id, f.form, r.reading FROM word_forms f JOIN word_readings r ON r.word_id = f.word_id"
    ):
        by_form_reading[(form.strip(), to_hiragana(reading.strip()))].add(word_id)

    word_levels: dict[int, set[int]] = defaultdict(set)
    rows = 0
    matched_rows = 0
    unmatched_rows = 0
    with args.csv.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            head = clean(row.get("Kanji"))
            reading = to_hiragana(clean(row.get("Reading")))
            raw_level = (row.get("Level") or "").strip()
            if not head or not reading or not raw_level.isdigit():
                continue
            level = int(raw_level)
            if not 1 <= level <= 5:
                continue
            rows += 1
            word_ids = by_form_reading.get((head, reading))
            if not word_ids:
                unmatched_rows += 1
                continue
            matched_rows += 1
            for word_id in word_ids:
                word_levels[word_id].add(level)

    ambiguous = {word_id: levels for word_id, levels in word_levels.items() if len(levels) > 1}
    insertable = {word_id: next(iter(levels)) for word_id, levels in word_levels.items() if len(levels) == 1}

    with ref:
        ref.execute("DELETE FROM word_jlpt")
        ref.executemany(
            "INSERT INTO word_jlpt (word_id, jlpt, source) VALUES (?, ?, 'Tanos')",
            ((word_id, level) for word_id, level in sorted(insertable.items())),
        )

    distribution = dict(
        ref.execute("SELECT jlpt, COUNT(*) FROM word_jlpt GROUP BY jlpt ORDER BY jlpt").fetchall()
    )
    ref.close()

    print(f"Tanos rows:              {rows:,}")
    print(f"matched rows:            {matched_rows:,}")
    print(f"unmatched rows:          {unmatched_rows:,}")
    print(f"words with one level:    {len(insertable):,}")
    print(f"ambiguous words skipped: {len(ambiguous):,}")
    print(f"levels:                  {distribution}")


if __name__ == "__main__":
    main()
