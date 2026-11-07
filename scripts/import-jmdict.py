"""Import JMdict_e into the word reference database.

Reference data lives in data/reference.db. User additions live in
data/user.db and this script only creates the empty user table.

The JMdict ent_seq is used as words.id. It is stable and unique, so there
is no second local word ID.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
JMDICT = ROOT / "sources" / "JMdict_e"
REFERENCE = ROOT / "data" / "reference.db"
USER = ROOT / "data" / "user.db"
WORD_SCHEMA = ROOT / "scripts" / "schema-words.sql"
USER_SCHEMA = ROOT / "scripts" / "schema-user-words.sql"


def main() -> None:
    if not JMDICT.exists():
        raise SystemExit(f"Missing {JMDICT}")
    if REFERENCE.exists():
        raise SystemExit(
            f"{REFERENCE} already exists; move it aside before rebuilding"
        )

    REFERENCE.parent.mkdir(parents=True, exist_ok=True)
    tmp = REFERENCE.with_suffix(".db.tmp")
    if tmp.exists():
        tmp.unlink()

    ref = sqlite3.connect(tmp)
    ref.executescript(WORD_SCHEMA.read_text(encoding="utf-8"))
    ref.execute("PRAGMA journal_mode = OFF")
    ref.execute("PRAGMA synchronous = OFF")
    ref.execute("PRAGMA foreign_keys = ON")

    entries = 0
    kana_only = 0
    common = 0
    forms = 0
    readings = 0
    senses = 0

    with ref:
        for _, entry in etree.iterparse(
            str(JMDICT),
            events=("end",),
            tag="entry",
            no_network=True,
        ):
            seq = int(entry.findtext("ent_seq"))
            k_elems = entry.findall("k_ele")
            r_elems = entry.findall("r_ele")
            sense_elems = entry.findall("sense")

            ke_pri = [p.text for k in k_elems for p in k.findall("ke_pri")]
            re_pri = [p.text for r in r_elems for p in r.findall("re_pri")]
            is_common = 1 if ke_pri or re_pri else 0
            is_kana_only = 1 if not k_elems else 0

            ref.execute(
                "INSERT INTO words (id) VALUES (?)",
                (seq,),
            )

            for k in k_elems:
                form = (k.findtext("keb") or "").strip()
                if not form:
                    continue
                infos = [x.text.strip() for x in k.findall("ke_inf") if x.text]
                ref.execute(
                    "INSERT OR IGNORE INTO word_forms (word_id, form, priority, info) VALUES (?, ?, ?, ?)",
                    (seq, form, 1 if k.findall("ke_pri") else 0, "; ".join(infos) or None),
                )
                forms += 1

            for r in r_elems:
                reading = (r.findtext("reb") or "").strip()
                if not reading:
                    continue
                infos = [x.text.strip() for x in r.findall("re_inf") if x.text]
                restrictions = [x.text.strip() for x in r.findall("re_restr") if x.text]
                ref.execute(
                    "INSERT OR IGNORE INTO word_readings (word_id, reading, priority, info, no_kanji, restriction) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        seq,
                        reading,
                        1 if r.findall("re_pri") else 0,
                        "; ".join(infos) or None,
                        1 if r.find("re_nokanji") is not None else 0,
                        "; ".join(restrictions) or None,
                    ),
                )
                readings += 1

            for index, sense in enumerate(sense_elems, start=1):
                pos_values = [p.text.strip() for p in sense.findall("pos") if p.text and p.text.strip()]
                misc_values = [m.text.strip() for m in sense.findall("misc") if m.text and m.text.strip()]
                pos = "; ".join(pos_values) or None
                misc = "; ".join(misc_values) or None
                glosses = [g.text.strip() for g in sense.findall("gloss") if g.text and g.text.strip()]
                if not glosses:
                    continue
                ref.execute(
                    "INSERT INTO word_senses (word_id, sense_no, pos, misc, gloss) VALUES (?, ?, ?, ?, ?)",
                    (seq, index, pos, misc, "; ".join(glosses)),
                )
                senses += 1

            entries += 1
            kana_only += is_kana_only
            common += is_common

            entry.clear()
            while entry.getprevious() is not None:
                del entry.getparent()[0]

            if entries % 25000 == 0:
                print(f"  {entries:,} entries...", flush=True)

    ref.commit()
    ref.close()
    os.replace(tmp, REFERENCE)

    user = sqlite3.connect(USER)
    user.executescript(USER_SCHEMA.read_text(encoding="utf-8"))
    user.commit()
    user_count = user.execute("SELECT COUNT(*) FROM user_word_added").fetchone()[0]
    user.close()

    print(f"entries:          {entries:,}")
    print(f"kana-only:        {kana_only:,}")
    print(f"common:           {common:,}")
    print(f"forms inserted:   {forms:,}")
    print(f"readings inserted:{readings:,}")
    print(f"senses inserted:  {senses:,}")
    print(f"user_word_added:  {user_count:,} rows")
    print(f"reference db:     {REFERENCE}")
    print(f"user db:          {USER}")


if __name__ == "__main__":
    main()
