"""Backfill phrases.hardest_jlpt from the kanji JLPT levels."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHRASES = ROOT / "data" / "phrases.db"
REFERENCE = ROOT / "data" / "reference.db"


def main() -> None:
    try:
        os.chmod(PHRASES, 0o644)
    except OSError:
        pass
    db = sqlite3.connect(PHRASES)
    db.execute("ATTACH DATABASE ? AS ref", (str(REFERENCE),))
    columns = {row[1] for row in db.execute("PRAGMA table_info(phrases)")}
    if "hardest_jlpt" not in columns:
        db.execute(
            "ALTER TABLE phrases ADD COLUMN hardest_jlpt INTEGER NOT NULL DEFAULT 0 CHECK (hardest_jlpt BETWEEN 0 AND 5)"
        )
    levels = {lit: int(level) for lit, level in db.execute("SELECT literal, jlpt FROM ref.kanjis WHERE jlpt IS NOT NULL")}
    updates = []
    for phrase_id, japanese in db.execute("SELECT id, japanese FROM phrases"):
        found = [levels.get(ch, 0) for ch in japanese if "\u4e00" <= ch <= "\u9fff"]
        updates.append((min(found) if found else 0, phrase_id))
    with db:
        db.executemany("UPDATE phrases SET hardest_jlpt = ? WHERE id = ?", updates)
    print(db.execute("SELECT hardest_jlpt, COUNT(*) FROM phrases GROUP BY hardest_jlpt ORDER BY hardest_jlpt").fetchall())
    db.close()


if __name__ == "__main__":
    main()
