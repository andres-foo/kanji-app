"""Import Tatoeba Japanese-English phrase pairs into data/phrases.db.

The first English translation in the export is kept for each Japanese
sentence. Furigana is intentionally left NULL for a later pass.
"""

from __future__ import annotations

import argparse
import csv
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHRASES = ROOT / "data" / "phrases.db"
SCHEMA = ROOT / "scripts" / "schema-phrases.sql"
DEFAULT_TSV = ROOT / "sources" / "Sentence pairs in Japanese-English - 2026-11-07.tsv"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tsv", type=Path, default=DEFAULT_TSV)
    args = parser.parse_args()
    if not args.tsv.exists():
        raise SystemExit(f"Missing {args.tsv}")
    if not PHRASES.exists():
        raise SystemExit(f"Missing {PHRASES}")

    # The app normally marks the phrase database read-only.
    try:
        os.chmod(PHRASES, 0o644)
    except OSError:
        pass

    phrases: dict[int, tuple[str, str]] = {}
    pairs = 0
    skipped = 0
    with args.tsv.open(encoding="utf-8", newline="") as fh:
        for row in csv.reader(fh, delimiter="\t"):
            if len(row) < 4:
                skipped += 1
                continue
            jid_text, japanese, _eid, english = row[:4]
            pairs += 1
            if not jid_text.isdigit() or not japanese.strip() or not english.strip():
                skipped += 1
                continue
            jid = int(jid_text)
            if jid not in phrases:
                phrases[jid] = (japanese.strip(), english.strip())

    db = sqlite3.connect(PHRASES)
    db.executescript(SCHEMA.read_text(encoding="utf-8"))
    with db:
        db.execute("DELETE FROM phrases")
        db.executemany(
            "INSERT INTO phrases (id, japanese, english, japanese_furigana, furigana_checked) VALUES (?, ?, ?, NULL, 0)",
            ((jid, japanese, english) for jid, (japanese, english) in sorted(phrases.items())),
        )

    count = db.execute("SELECT COUNT(*) FROM phrases").fetchone()[0]
    sample = db.execute(
        "SELECT id, japanese, english FROM phrases WHERE japanese = ? LIMIT 1",
        ("何と言ったら良いか分かりません。",),
    ).fetchone()
    db.close()

    print(f"pair lines:       {pairs:,}")
    print(f"unique Japanese:  {len(phrases):,}")
    print(f"inserted phrases: {count:,}")
    print(f"skipped:          {skipped:,}")
    print("sample:", sample)


if __name__ == "__main__":
    main()
