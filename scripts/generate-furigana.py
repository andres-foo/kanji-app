"""Generate token-level furigana HTML for imported Tatoeba phrases.

Readings are generated with SudachiPy and stored on the phrase. They are
intentionally marked furigana_checked = 0 so they can be reviewed later.
"""

from __future__ import annotations

import argparse
import html
import os
import sqlite3
import time
from pathlib import Path

from sudachipy import dictionary

ROOT = Path(__file__).resolve().parents[1]
PHRASES = ROOT / "data" / "phrases.db"
KANJI = range(0x4E00, 0x9FFF + 1)


def to_hiragana(value: str) -> str:
    return "".join(chr(ord(ch) - 0x60) if "\u30a1" <= ch <= "\u30f6" else ch for ch in value)


def has_kanji(value: str) -> bool:
    return any(ord(ch) in KANJI for ch in value)


def render(text: str, tokenizer) -> str:
    out: list[str] = []
    for morpheme in tokenizer.tokenize(text):
        surface = morpheme.surface()
        reading = to_hiragana(morpheme.reading_form() or "")
        if has_kanji(surface) and reading and reading != surface:
            out.append(f"<ruby>{html.escape(surface)}<rt>{html.escape(reading)}</rt></ruby>")
        else:
            out.append(html.escape(surface))
    return "".join(out)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Process only this many rows (for testing)")
    args = parser.parse_args()
    if not PHRASES.exists():
        raise SystemExit(f"Missing {PHRASES}")

    try:
        os.chmod(PHRASES, 0o644)
    except OSError:
        pass

    tokenizer = dictionary.Dictionary().tokenizer()
    db = sqlite3.connect(PHRASES)
    rows = db.execute(
        "SELECT id, japanese FROM phrases WHERE japanese_furigana IS NULL ORDER BY id"
        + (" LIMIT ?" if args.limit else ""),
        ((args.limit,) if args.limit else ()),
    ).fetchall()
    started = time.perf_counter()
    updates = []
    for index, (phrase_id, japanese) in enumerate(rows, 1):
        updates.append((render(japanese, tokenizer), phrase_id))
        if len(updates) >= 500:
            with db:
                db.executemany("UPDATE phrases SET japanese_furigana = ? WHERE id = ?", updates)
            updates.clear()
        if index % 10000 == 0:
            print(f"processed {index:,}/{len(rows):,}", flush=True)
    if updates:
        with db:
            db.executemany("UPDATE phrases SET japanese_furigana = ? WHERE id = ?", updates)
    db.commit()
    total = db.execute("SELECT COUNT(*) FROM phrases WHERE japanese_furigana IS NOT NULL").fetchone()[0]
    db.close()
    print(f"generated {len(rows):,} phrases in {time.perf_counter() - started:.1f}s; total {total:,}", flush=True)


if __name__ == "__main__":
    main()
