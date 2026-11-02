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
- Search covers kanji, keywords, meanings, readings and romaji. It requires at least two characters for text, but single kanji/kana lookups are allowed; empty queries are rejected.
- No dependencies: `bun:sqlite` is built in.

Assumptions you can change at the top of `server.ts`:
- `frequency` and `freq_wiki` are ranks (1 = most common), so lower sorts first.
- `jlpt` is 1 to 5 (shown as N1 to N5) and `kanken` is shown as-is.


## Scoring and review system

Every kanji in your study list (`added = 1`) has a **score**. The score does not decide *which* kanji comes next. It decides **when the kanji is due again**: each answer moves the score up or down, and the new score is looked up in a table of intervals (in days) to set the next due date. Anything due today or earlier is waiting in the review queue.

In short:

```
answer  →  new score  →  interval for that score  →  due date = today + interval
```

---

### 1. Key concepts

| Term | Meaning |
|---|---|
| **Score** | A whole number from **-3 to 10** stored in `kanjis.score`. A new kanji starts at **0**. |
| **Mastery level** | A named band of scores (Weak, New, Learning, Familiar, Strong, Mastered). Shown as a badge on the kanji page. |
| **Interval** | How many days until the kanji is due again. It depends only on the score the kanji has *after* the answer. |
| **Due date** | `kanjis.due_date`, a `YYYY-MM-DD` date. Empty (`NULL`) means "never scheduled", which counts as due now. |
| **Queue** | All added kanji with an empty due date or a due date of today or earlier. |
| **Review counter** | The number in the navbar, `Review (N)`. It is the size of the queue right now. |

---

### 2. The score scale and mastery levels

The scale and the days are stored in the `mastery_levels` table (`score`, `label`, `interval_days`). These are the defaults. You can rename the labels and change the days on the **Settings** page.

| Score | Mastery level | Days until next review |
|---:|---|---:|
| -3 | Weak | 1 |
| -2 | Weak | 1 |
| -1 | Weak | 1 |
| 0 | New | 1 |
| 1 | Learning | 1 |
| 2 | Learning | 2 |
| 3 | Learning | 3 |
| 4 | Familiar | 4 |
| 5 | Familiar | 6 |
| 6 | Familiar | 8 |
| 7 | Strong | 12 |
| 8 | Strong | 16 |
| 9 | Strong | 20 |
| 10 | Mastered | 25 |

Notes:

- If a row is missing from `mastery_levels` (or the table does not exist), the app uses the built-in default for that score, so a review never fails because of it.
- The scale itself (-3 to 10) is fixed in the code. The floor and ceiling in the settings can only narrow it, never widen it.

---

### 3. The four answers

On the answer page there are four buttons. Each one changes the score by the amount in the `settings` table, then keeps the result between the **floor** and the **ceiling**.

| Button | Setting key | Default change | Next due date |
|---|---|---:|---|
| **Bad** | `review_delta_bad` | -3 | **Today.** The kanji stays in the queue and comes back this session. |
| **Neutral** | `review_delta_neutral` | 0 | Today + interval of the (unchanged) score |
| **Good** | `review_delta_good` | +1 | Today + interval of the new score |
| **Easy** | `review_delta_easy` | +2 | Today + interval of the new score |

The formula:

```
after    = clamp(before + change, floor, ceiling)
due_date = today                       if the answer was Bad
         = today + interval(after)     otherwise
```

Details:

- `before` is the kanji's score when you pressed the button. An empty score counts as 0.
- The interval is counted **from today**, not from the old due date. Reviewing a kanji late does not shorten or stretch the next interval.
- Bad always makes the kanji due today, whatever the interval table says.
- At the floor (-3), Bad cannot lower the score further. The answer is still saved in the history and the kanji still comes back today.
- At the ceiling (10), Good and Easy cannot raise the score further, but the kanji is still rescheduled with the 25-day interval.

---

### 4. Settings

Values live in the `settings` table (`key`, `value`, stored as text). If a row is missing or is not a number, the default is used.

| Key | Default | Meaning | Editable on Settings page? |
|---|---:|---|---|
| `review_score_floor` | -3 | Lowest score a kanji can have | No (database only) |
| `review_score_ceiling` | 10 | Highest score a kanji can have | No (database only) |
| `review_score_start` | 0 | Score given when a kanji is added, and the value **Reset scores** sets | No (database only) |
| `review_delta_bad` | -3 | Score change for Bad | Yes |
| `review_delta_neutral` | 0 | Score change for Neutral | Yes |
| `review_delta_good` | 1 | Score change for Good | Yes |
| `review_delta_easy` | 2 | Score change for Easy | Yes |

Also on the Settings page: the **mastery levels** (label and days for every score) and the red **Reset scores** button.

Notes:

- The floor and ceiling are clamped to the -3 to 10 scale. If the floor is set higher than the ceiling, the two are swapped.
- The starting score is clamped between the floor and the ceiling.
- Score changes must be whole numbers from -10 to 10. Days must be whole numbers from 1 to 3650.

---

### 5. The review flow, step by step

| Step | What you do | What the app does | Saved? |
|---|---|---|---|
| 1 | Click **Review (N)** in the navbar (`/review`) | Picks the next kanji from the queue and redirects to `/review/<kanji>` | **Nothing** |
| 2 | Look at the question page | Shows the big kanji and the added example words that contain it | Nothing |
| 3 | Click **Show answer** | Opens the normal kanji page with `?review=1`, which shows the four answer buttons | Nothing |
| 4 | Press **Bad / Neutral / Good / Easy** | Updates the score and dates, writes a row to `review_history`, redirects to `/review` | **Yes** |
| 5 | (automatic) | `/review` picks the next kanji, back to step 2 | Nothing |

Important:

- **Only pressing an answer button records anything.** Visiting `/review`, loading a question page, or pressing **Review** in the navbar to skip a kanji changes nothing: the kanji stays due and can come back.
- The pick is made fresh each time. Among kanji that tie completely (see below), the choice is random, so reloading `/review` can show a different kanji.
- When nothing is due, `/review` shows "Nothing to review right now" and tells you how many kanji are due on the next date.
- An answer applies to whichever kanji page you pressed it on.

---

### 6. Which kanji comes next

The queue is every kanji with `added = 1` and (`due_date` empty **or** `due_date <= today`). The next kanji is chosen by this order:

| Priority | Sort | Effect |
|---:|---|---|
| 1 | `due_date` ascending, empty first | Never-scheduled kanji first, then the most overdue |
| 2 | `last_reviewed` ascending, empty first | Among equals, the one reviewed longest ago |
| 3 | `score` ascending | Among equals, the weakest |
| 4 | Random | Final tie-break |

Because of this order, a kanji you just answered Bad on (due today, reviewed today) sorts **after** kanji that were due on earlier days, so it comes back once the older ones are done, not instantly.

There is no daily limit. You can keep reviewing for as long as the queue has kanji.

---

### 7. Adding, removing and resetting

| Action | Where | Score | Due date / last reviewed |
|---|---|---|---|
| **Add** a kanji that was not added | **Added** checkbox in the edit form, or the Add button on a search result row | Set to the starting score (default 0) | Cleared, so it is due immediately |
| **Remove** a kanji | Untick **Added**, or the Remove button on a search row | **Kept** | Kept |
| **Re-add** a kanji that was removed | Same as Add | **Reset** to the starting score | Cleared |
| **Reset scores** | Red button on the Settings page (asks for confirmation) | Every added kanji set to the starting score | Cleared for every added kanji, so all are due now |

Notes:

- A removed kanji is no longer in the queue (the queue only contains `added = 1`), even though its score is kept.
- Reset scores only touches added kanji. The review history is not changed.
- The **Unfinished** and **Is component** checkboxes in the edit form are saved exactly as shown. The Add/Remove buttons on search rows also set `unfinished` automatically (on when adding, off when removing).

---

### 8. Review history

Every answer adds one row to `review_history`. Rows are never deleted: it is a permanent log.

| Column | Content |
|---|---|
| `id` | Row number |
| `kanji` | The kanji reviewed |
| `date` | Local date and time of the answer (`YYYY-MM-DD HH:MM:SS`) |
| `before` | Score before the answer |
| `after` | Score after the answer (after clamping to the floor and ceiling) |
| `type` | `bad`, `neutral`, `good` or `easy` |

The Stats page only counts rows whose `type` is one of those four values.

---

### 9. Worked example

A new kanji, using the default settings:

| Day | Answer | Score before | Change | Score after | Interval | Next due |
|---:|---|---:|---:|---:|---|---|
| 1 | Good | 0 | +1 | 1 | 1 day | Day 2 |
| 2 | Easy | 1 | +2 | 3 | 3 days | Day 5 |
| 5 | Good | 3 | +1 | 4 | 4 days | Day 9 |
| 9 | Easy | 4 | +2 | 6 | 8 days | Day 17 |
| 17 | **Bad** | 6 | -3 | 3 | **today** | Day 17 (again) |
| 17 | Good | 3 | +1 | 4 | 4 days | Day 21 |

A new kanji you do not recognise:

| Answer | Score before | Change | Score after | Next due |
|---|---:|---:|---:|---|
| Bad | 0 | -3 | -3 | Today (Weak) |
| Bad | -3 | -3 | -3 (floor) | Today |
| Good | -3 | +1 | -2 | Tomorrow (1 day) |
| Good | -2 | +1 | -1 | Tomorrow |
| Good | -1 | +1 | 0 | Tomorrow |
| Good | 0 | +1 | 1 | Tomorrow, then it is Learning |

From the floor, three Goods get a kanji back to 0.

---

### 10. Stats page

The **Stats** page (`/stats`) is built from the review history and the current state of your list. Choose 30 days, 90 days or 6 months at the top.

| Section | What it shows |
|---|---|
| **Cards** | Kanji in your list, **Due now** (the queue size), reviewed today, and the **Not bad** percentage for the chosen period |
| **Kanji by level** | A stacked chart of how many kanji sit at each mastery level on each day, rebuilt from the `after` scores in the history |
| **Coming up** | How many kanji are already scheduled for each of the next 14 days (overdue kanji are counted in "due now") |
| **Answers by level** | For each score: number of reviews, split of Bad / Neutral / Good / Easy, the **Not bad** percentage and a verdict |

Definitions:

- **Not bad** = every answer except Bad (Neutral + Good + Easy) divided by all answers.
- **Level** in the answers table is the score the kanji had *before* the answer, since that is the interval that was just tested.
- **Verdict** for each level, to help you tune the intervals:

| Condition | Verdict | Suggestion |
|---|---|---|
| Fewer than 30 reviews | Not enough data | Wait for more reviews |
| Not bad below 80% | Too hard | Shorten the interval of this score |
| Not bad from 80% to 95% | About right | Leave it |
| Not bad above 95% | Too easy | Lengthen the interval of this score |

A kanji is reviewed at score *s* because it was scheduled with the interval of score *s*, so the answers at that level are the best test of that interval. Reviews that happen the same day as a Bad answer are counted too, so the lowest levels can look harsher than their interval alone.

---

### 11. Things to know

- **Dates use the server's local date.** Due dates and the queue use `date('now', 'localtime')`. If the app runs on a server set to another timezone (many hosts use UTC), reviews in the evening can land on the next day. Set the server's timezone (for example `TZ=America/Santiago`).
- **Database columns.** Reviewing needs `kanjis.score`, `kanjis.last_reviewed` and `kanjis.due_date`, and the tables `review_history`, `settings` and `mastery_levels`. If a column is missing, review pages show an error naming it.
- **`added_at` is not set by the app yet.** The stats chart counts a kanji from its `added_at` date when it has one. Without it, a kanji counts for the whole period.
- **Old history.** Reviews saved before the 0-to-10 scale (and the four-button system) used different score meanings. They are still in `review_history` and will skew the Stats page for periods that reach back that far.
- **The priority colours are separate.** The green / orange / red / grey backgrounds on JLPT and Kanken badges depend only on how many kanji are added, finished and not components. They have nothing to do with review scores.
- **Backups.** The database file is the only copy of your scores and history. Copy it somewhere else regularly, and before using **Reset scores**.