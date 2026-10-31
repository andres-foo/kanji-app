# Kanji app

Server-rendered Bun app (no frontend JavaScript) over your SQLite database.

Light and dark themes are available from the header toggle. The choice is stored in a
`kanji_theme` cookie; with no cookie the page follows the operating system's
`prefers-color-scheme` setting. The kanji Details section likewise remembers whether
it was left open or closed in a `kanji_details` cookie.

    bun run start            # http://localhost:3000
    DB_PATH=/path/to/kanji.db IMAGES_DIR=/path/to/images PORT=3000 bun run start

- `DB_PATH` (default `./kanji.db`): opened read-only. Needs the `kanjis` and `examples` tables.
- `IMAGES_DIR` (default `./images`): put `水.jpg` or `水.png` here (file name = the literal). Square images look best. They are picked up on the next page load.
- Search requires at least two characters for text, but single kanji/kana lookups are allowed. Empty queries are rejected.
- No dependencies: `bun:sqlite` is built in.

Assumptions you can change at the top of `server.ts`:
- `frequency` and `freq_wiki` are ranks (1 = most common), so lower sorts first.
- `jlpt` is 1 to 5 (shown as N1 to N5) and `kanken` is shown as-is.
