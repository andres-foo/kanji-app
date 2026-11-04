import { PORT } from "./src/config";
import { db } from "./src/db";
import { esc, html, likeEsc, highlight, nullsLast, enc } from "./src/html";
import { requestContext, themeFrom, detailsOpenFrom, sameOrigin, safeBack } from "./src/prefs";
import { dueCount, dueCounts, pickReviewKanji, saveReview, type ReviewResult } from "./src/review";
import { layout } from "./src/views/layout";
import { kanjiPage } from "./src/views/kanji";
import { findImage, imagePath, kanjiExists, MAX_IMAGE_BYTES, removeImages, sniffImage } from "./src/images";
import { setting, startScore, type SettingKey } from "./src/settings";
import { MAX_SCORE, MIN_SCORE, masteryLevels } from "./src/mastery";
import type { Kanji, Word } from "./src/types";
import { addDays, STAT_RANGES, verdict } from "./src/stats";
import { areaChart, barChart, BLUES } from "./src/views/charts";
import { home } from "./src/views/home";
import { levelPage, myListPage } from "./src/views/lists";
import { splitKanjiMarker } from "./src/views/shared";

// flip examples.added between 0 and 1, then go back to where the user was
async function toggleWord(req: Request, id: number) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  try {
    db.run(`UPDATE examples SET added = CASE WHEN COALESCE(added, 0) = 1 THEN 0 ELSE 1 END WHERE id = ?`, [id]);
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not update the word: ${esc((e as Error).message)}. Is the database file writable?</div>`), 500);
  }
  return new Response(null, { status: 303, headers: { location: `${back}#w${id}` } });
}

// flip kanjis.added between 0 and 1 (a newly added kanji starts out unfinished), then go back to the kanji page
async function toggleKanji(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  try {
    db.run(
      `UPDATE kanjis
       SET added = CASE WHEN COALESCE(added, 0) = 1 THEN 0 ELSE 1 END,
           unfinished = CASE WHEN COALESCE(added, 0) = 1 THEN 0 ELSE 1 END,
           score = CASE WHEN COALESCE(added, 0) = 1 THEN score ELSE ? END,
           due_date = CASE WHEN COALESCE(added, 0) = 1 THEN due_date ELSE NULL END,
           last_reviewed = CASE WHEN COALESCE(added, 0) = 1 THEN last_reviewed ELSE NULL END
       WHERE literal = ?`,
      [startScore(), literal],
    );
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not update the kanji: ${esc((e as Error).message)}. Is the database file writable?</div>`), 500);
  }
  return new Response(null, { status: 303, headers: { location: back } });
}

// save the edit form: text fields (empty -> NULL) and the checkboxes (checked -> 1, unchecked -> 0).
// Ticking "Added" on a kanji that was not added starts it from scratch (starting score, due now); unticking it keeps its score.
async function updateKanji(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const text = (name: string) => String(form.get(name) ?? "").replace(/\r\n?/g, "\n").trim() || null;
  const flag = (name: string) => (form.get(name) ? 1 : 0);
  const added = flag("added");
  try {
    // the CASE expressions see the old row, so they can tell that the kanji is being added right now
    const result = db.run(
      `UPDATE kanjis
       SET keyword = ?, components = ?, other_forms = ?, related = ?, story = ?, unfinished = ?, is_component = ?,
           score = CASE WHEN COALESCE(added, 0) = 0 AND ? = 1 THEN ? ELSE score END,
           due_date = CASE WHEN COALESCE(added, 0) = 0 AND ? = 1 THEN NULL ELSE due_date END,
           last_reviewed = CASE WHEN COALESCE(added, 0) = 0 AND ? = 1 THEN NULL ELSE last_reviewed END,
           added = ?
       WHERE literal = ?`,
      [text("keyword"), text("components"), text("other_forms"), text("related"), text("story"), flag("unfinished"), flag("is_component"), added, startScore(), added, added, added, literal],
    );
    if (!result.changes) return html(layout("Not found", "", `<div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not update the kanji: ${esc((e as Error).message)}. Is the database file writable?</div>`), 500);
  }
  return new Response(null, { status: 303, headers: { location: back } });
}

const imageError = (msg: string, status: number) =>
  html(layout("Error", "", `<div class="box empty">${esc(msg)}</div>`), status);

// replace the kanji's image with an uploaded jpg/png and make sure no file of the other format remains
async function uploadImage(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  if (!kanjiExists(literal)) return imageError(`“${literal}” is not in the database.`, 404);
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return imageError("No image was selected.", 400);
  if (file.size > MAX_IMAGE_BYTES) return imageError(`The image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) return imageError("Only JPEG and PNG images are supported.", 415);
  try {
    await Bun.write(imagePath(literal, ext), bytes);
  } catch (e) {
    return imageError(`Could not save the image: ${(e as Error).message}. Is the images folder writable?`, 500);
  }
  const problem = await removeImages(literal, ext);
  if (problem) return imageError(problem, 500);
  return new Response(null, { status: 303, headers: { location: back } });
}

// delete the kanji's image (every format) and verify it is gone
async function deleteImage(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  if (!kanjiExists(literal)) return imageError(`“${literal}” is not in the database.`, 404);
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const problem = await removeImages(literal);
  if (problem) return imageError(problem, 500);
  return new Response(null, { status: 303, headers: { location: back } });
}

// store the explicit theme (or clear it) in a cookie, then go back to where the user was
async function setTheme(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const value = String(form.get("theme") ?? "");
  const theme: Theme | null = value === "light" || value === "dark" ? value : null;
  const headers = new Headers({ location: safeBack(form.get("back")) });
  headers.set("set-cookie", theme
    ? `kanji_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`
    : `kanji_theme=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
  return new Response(null, { status: 303, headers });
}

// remember whether the details table is shown, then go back to the kanji page
async function toggleDetails(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const open = form.get("details") === "open";
  const headers = new Headers({ location: safeBack(form.get("back")) });
  headers.set("set-cookie", `kanji_details=${open ? "open" : "closed"}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
  return new Response(null, { status: 303, headers });
}

// ---------- review ----------
function reviewNext() {
  try {
    const literal = pickReviewKanji();
    if (!literal) {
      const added = (db.query(`SELECT COUNT(*) AS n FROM kanjis WHERE COALESCE(added, 0) = 1`).get() as { n: number }).n;
      if (!added) return html(layout("Review – Kanji", "", `<div class="box empty">No kanji in your list to review yet.</div>`));
      const next = db.query(
        `SELECT due_date, COUNT(*) AS n FROM kanjis WHERE COALESCE(added, 0) = 1 AND due_date > date('now', 'localtime')
         GROUP BY due_date ORDER BY due_date LIMIT 1`,
      ).get() as { due_date: string; n: number } | null;
      const when = next ? `<br>Next up: ${next.n} kanji due on ${esc(next.due_date)}.` : "";
      return html(layout("Review – Kanji", "", `<div class="box empty">Nothing to review right now.${when}</div>`));
    }
    return new Response(null, { status: 303, headers: { location: `/review/${enc(literal)}` } });
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not choose a kanji to review: ${esc((e as Error).message)}. Did you add the last_reviewed and due_date columns?</div>`), 500);
  }
}

// the question side: just the kanji and the added example words that contain it
function reviewPage(literal: string) {
  const k = db.query(`SELECT literal FROM kanjis WHERE literal = ?`).get(literal) as { literal: string } | null;
  if (!k) return html(layout("Not found", "", `<div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);
  const words = db.query(`SELECT * FROM examples WHERE COALESCE(added, 0) = 1 AND kanji LIKE ? ESCAPE '\\'`).all(`%${likeEsc(literal)}%`) as Word[];
  words.sort((a, b) => nullsLast(a.freq_wiki || null, b.freq_wiki || null) || (b.jlpt ?? 0) - (a.jlpt ?? 0));
  const list = words.map((w) => `<span class="rvw k">${esc(splitKanjiMarker(w.kanji ?? "").text)}</span>`).join("");
  const body = `<div class="kanji-card rv"><div class="rvbig k">${esc(k.literal)}</div>${list ? `<div class="rvwords">${list}</div>` : ""}</div>`;
  const bar = `<a class="reviewbtn" href="/kanji/${enc(k.literal)}?review=1" aria-keyshortcuts="Space"><kbd class="kbd">Space</kbd><span class="pad">A</span>Show answer</a>`;
  return html(layout("Review – Kanji", "", body, "", bar));
}

async function reviewResult(req: Request, literal: string, result: ReviewResult) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  try {
    const found = saveReview(literal, result);
    if (!found) return html(layout("Not found", "", `<div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not save the review: ${esc((e as Error).message)}. Is the database file writable, and do the last_reviewed and due_date columns exist?</div>`), 500);
  }
  return new Response(null, { status: 303, headers: { location: "/review" } });
}

// ---------- settings page ----------
const DELTA_FIELDS: { key: SettingKey; label: string; hint: string }[] = [
  { key: "review_delta_bad", label: "Bad", hint: "Score change when you press Bad." },
  { key: "review_delta_neutral", label: "Neutral", hint: "Score change when you press Neutral." },
  { key: "review_delta_good", label: "Good", hint: "Score change when you press Good." },
  { key: "review_delta_easy", label: "Easy", hint: "Score change when you press Easy." },
];
// the score scale (-3 to 10) and the starting score live in the settings table and are edited in the database; this page
// edits the score changes for Bad / Neutral / Good and the mastery levels (label and days until the next review), and resets scores.
function settingsPage(url: URL, errors: string[] = [], submitted?: Record<string, string>, status = 200) {
  const resetCount = url.searchParams.get("reset");
  const notice = errors.length
    ? `<p class="notice err">${errors.map(esc).join("<br>")}</p>`
    : url.searchParams.get("saved") === "1" ? `<p class="notice ok">Settings saved.</p>`
      : resetCount !== null ? `<p class="notice ok">${esc(resetCount)} added kanji were reset to score ${esc(url.searchParams.get("to") ?? "")} and are due now.</p>` : "";
  const rows = masteryLevels().map((m) => `<div class="mlrow"><span class="mlscore">${m.score}</span>
<input type="text" maxlength="30" name="label_${m.score}" value="${esc(submitted?.[`label_${m.score}`] ?? m.label)}" aria-label="Label for score ${m.score}" required>
<input type="number" step="1" min="1" max="3650" name="days_${m.score}" value="${esc(submitted?.[`days_${m.score}`] ?? String(m.interval_days))}" aria-label="Days until next review for score ${m.score}" required></div>`).join("");
  const body = `<h1>SETTINGS</h1>${notice}<div class="box setbox">
<form class="editf" style="margin-top:0" method="post" action="/settings">
<section><h2>Score changes</h2><div class="setgrid">${DELTA_FIELDS.map((f) => `<label class="fl">${f.label}
<input type="number" step="1" min="-10" max="10" name="${f.key}" value="${esc(submitted?.[f.key] ?? String(setting(f.key)))}" required>
<span class="hint">${f.hint}</span></label>`).join("")}</div></section>
<section><h2>Mastery levels</h2>
<p class="hint">After a review, the kanji's new score decides when it is due again. The label is shown on the kanji page. A bad answer is always due again today.</p>
<div class="mlrow mlhead"><span>Score</span><span>Label</span><span>Days</span></div>${rows}</section>
<div class="formbtns"><button class="reviewbtn" type="submit">Save</button></div></form>
<form class="resetrow" method="post" action="/settings/reset-scores" data-msg="Reset every added kanji to score ${startScore()} and make them all due now? This cannot be undone." onsubmit="return confirm(this.dataset.msg)">
<button class="reviewbtn bad" type="submit">Reset scores</button><span class="hint">Sets every added kanji to the starting score (${startScore()}) and makes it due now.</span></form></div>`;
  return html(layout("Settings – Kanji", "", body), status);
}

async function saveSettings(req: Request, url: URL) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const submitted: Record<string, string> = {};
  const levels: Mastery[] = [];
  const deltas: [SettingKey, number][] = [];
  const errors: string[] = [];
  for (const f of DELTA_FIELDS) {
    const text = String(form.get(f.key) ?? "").trim();
    submitted[f.key] = text;
    const n = Number(text);
    if (text === "" || !Number.isInteger(n) || n < -10 || n > 10) errors.push(`${f.label} must be a whole number from -10 to 10.`);
    else deltas.push([f.key, n]);
  }
  for (let score = MIN_SCORE; score <= MAX_SCORE; score++) {
    const label = String(form.get(`label_${score}`) ?? "").trim();
    const daysText = String(form.get(`days_${score}`) ?? "").trim();
    submitted[`label_${score}`] = label;
    submitted[`days_${score}`] = daysText;
    const days = Number(daysText);
    if (!label) errors.push(`Score ${score}: the label cannot be empty.`);
    else if (label.length > 30) errors.push(`Score ${score}: the label is too long (30 characters at most).`);
    if (daysText === "" || !Number.isInteger(days) || days < 1 || days > 3650) errors.push(`Score ${score}: days must be a whole number from 1 to 3650.`);
    levels.push({ score, label, interval_days: days });
  }
  if (errors.length) return settingsPage(url, errors, submitted, 400);
  try {
    db.transaction(() => {
      for (const [key, value] of deltas) {
        db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
      }
      for (const m of levels) {
        db.run(
          `INSERT INTO mastery_levels (score, label, interval_days) VALUES (?, ?, ?)
           ON CONFLICT(score) DO UPDATE SET label = excluded.label, interval_days = excluded.interval_days`,
          [m.score, m.label, m.interval_days],
        );
      }
    })();
  } catch (e) {
    return settingsPage(url, [`Could not save the settings: ${(e as Error).message}. Do the settings and mastery_levels tables exist?`], submitted, 500);
  }
  return new Response(null, { status: 303, headers: { location: "/settings?saved=1" } });
}

// sets every added kanji to the starting score and makes it due now (no due date, never reviewed)
async function resetScores(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const start = startScore();
  try {
    const res = db.run(`UPDATE kanjis SET score = ?, due_date = NULL, last_reviewed = NULL WHERE COALESCE(added, 0) = 1`, [start]);
    return new Response(null, { status: 303, headers: { location: `/settings?reset=${res.changes}&to=${start}` } });
  } catch (e) {
    return settingsPage(new URL(req.url), [`Could not reset the scores: ${(e as Error).message}. Is the database file writable, and do the last_reviewed and due_date columns exist?`], undefined, 500);
  }
}

// ---------- stats page ----------
// the three due states: green = no due date yet (new), blue = due today, red = overdue
const DUE_COLORS = { fresh: "#16A34A", today: "#2a78d6", overdue: "#DC2626" } as const;

function statsPage(url: URL) {
  try {
    const range = STAT_RANGES.find((r) => String(r) === url.searchParams.get("days")) ?? 30;
    const today = (db.query(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;
    const due = dueCounts();
    const days = Array.from({ length: range }, (_, i) => addDays(today, i - (range - 1)));
    const first = days[0];
    const TYPES = `type IN ('bad', 'neutral', 'good', 'easy')`;

    // levels are grouped by label (the labels come from mastery_levels), ordered by score
    const levels = masteryLevels();
    const labels: string[] = [];
    const groupOf = new Map<number, number>();
    for (const m of levels) {
      let g = labels.indexOf(m.label);
      if (g < 0) g = labels.push(m.label) - 1;
      groupOf.set(m.score, g);
    }
    const color = (g: number) => BLUES[labels.length <= 1 ? 0 : Math.round((g * (BLUES.length - 1)) / (labels.length - 1))];

    // score of each added kanji at the end of each day: the "after" of its last review up to that day
    // (kanji with an added_at date only count from that day on; without one they count for the whole period)
    const kanji = db.query(`SELECT literal, added_at FROM kanjis WHERE COALESCE(added, 0) = 1`).all() as { literal: string; added_at: string | null }[];
    const reviews = db.query(`SELECT kanji, date(date) AS d, "after" AS a FROM review_history WHERE ${TYPES} ORDER BY date, id`).all() as { kanji: string; d: string; a: number }[];
    const byKanji = new Map<string, { d: string; a: number }[]>();
    for (const r of reviews) (byKanji.get(r.kanji) ?? byKanji.set(r.kanji, []).get(r.kanji)!).push(r);
    const counts = labels.map(() => days.map(() => 0));
    const start = startScore();
    for (const k of kanji) {
      const list = byKanji.get(k.literal) ?? [];
      const addedOn = /^\d{4}-\d{2}-\d{2}/.test(String(k.added_at ?? "")) ? String(k.added_at).slice(0, 10) : "";
      let p = 0;
      let score = start;
      days.forEach((day, i) => {
        while (p < list.length && list[p].d <= day) score = Math.round(Number(list[p++].a) || 0);
        if (addedOn && addedOn > day) return;
        counts[groupOf.get(Math.min(MAX_SCORE, Math.max(MIN_SCORE, score))) ?? 0][i]++;
      });
    }
    const last = days.length - 1;
    const series = labels.map((label, g) => ({ label, color: color(g), values: counts[g] }));
    const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)} ${s.values[last]}</span>`).join("");

    // answers by the level the kanji was at when reviewed, inside the selected period
    const answers = new Map<number, { bad: number; neutral: number; good: number; easy: number }>();
    for (const r of db.query(`SELECT "before" AS s, type, COUNT(*) AS n FROM review_history WHERE ${TYPES} AND date(date) >= ? GROUP BY "before", type`).all(first) as { s: number; type: ReviewResult; n: number }[]) {
      const sc = Math.round(Number(r.s));
      if (sc < MIN_SCORE || sc > MAX_SCORE) continue;
      const a = answers.get(sc) ?? { bad: 0, neutral: 0, good: 0, easy: 0 };
      a[r.type] += r.n;
      answers.set(sc, a);
    }
    let totalAll = 0;
    let okAll = 0;
    for (const a of answers.values()) { totalAll += a.bad + a.neutral + a.good + a.easy; okAll += a.neutral + a.good + a.easy; }
    const tableRows = levels.map((m) => {
      const a = answers.get(m.score) ?? { bad: 0, neutral: 0, good: 0, easy: 0 };
      const t = a.bad + a.neutral + a.good + a.easy;
      const ok = t ? Math.round((100 * (a.neutral + a.good + a.easy)) / t) : 0; // everything except bad
      const pb = t ? Math.round((100 * a.bad) / t) : 0;
      const pn = t ? Math.round((100 * a.neutral) / t) : 0;
      const pg = t ? Math.round((100 * a.good) / t) : 0;
      const pe = t ? 100 - pb - pn - pg : 0;
      const v = verdict(t, ok);
      const mix = t
        ? `<div class="mix"><span style="width:${pb}%;background:#e34948"></span><span style="width:${pn}%;background:#9CA3AF"></span><span style="width:${pg}%;background:#2a78d6"></span><span style="width:${pe}%;background:#1baf7a"></span></div><div class="mixn">${pb}% / ${pn}% / ${pg}% / ${pe}%</div>`
        : `<span class="mixn">no reviews yet</span>`;
      return `<tr><td><b>${m.score}</b> · ${esc(m.label)}</td><td>${m.interval_days} ${m.interval_days === 1 ? "day" : "days"}</td><td class="num">${t.toLocaleString("en-US")}</td><td>${mix}</td><td class="num">${t ? ok + "%" : "–"}</td><td><span class="vd ${v.cls}">${v.text}</span></td></tr>`;
    }).join("");

    // already scheduled for the next 14 days (kanji that are overdue count as "due now")
    const sched = new Map((db.query(`SELECT due_date AS d, COUNT(*) AS n FROM kanjis WHERE COALESCE(added, 0) = 1 AND due_date > ? AND due_date <= ? GROUP BY due_date`).all(today, addDays(today, 14)) as { d: string; n: number }[]).map((r) => [r.d, r.n]));
    const fDays = Array.from({ length: 14 }, (_, i) => addDays(today, i + 1));
    const fValues = fDays.map((d) => sched.get(d) ?? 0);
    // the "Now" column is the queue split into its three due states; the next 14 columns are already-scheduled counts
    const nowBar = [
      { value: due.fresh, color: DUE_COLORS.fresh },
      { value: due.today, color: DUE_COLORS.today },
      { value: due.overdue, color: DUE_COLORS.overdue },
    ];
    const comingBars = fValues.map((v) => [{ value: v, color: BLUES[4] }]);
    const comingTitles = fDays.map((d, i) => `${d}: ${fValues[i]} kanji already scheduled`);

    const reviewedToday = (db.query(`SELECT COUNT(*) AS n FROM review_history WHERE ${TYPES} AND date(date) = ?`).get(today) as { n: number }).n;
    const pill = (r: number) => `<a class="pill${r === range ? " on" : ""}" href="/stats?days=${r}">${r === 180 ? "6 months" : `${r} days`}</a>`;
    const body = `<h1>STATS</h1>
<div class="pills">${STAT_RANGES.map(pill).join("")}</div>
<div class="cards">
<div class="sc"><b>${kanji.length}</b><span>Kanji in your list</span></div>
<div class="sc due-fresh"><b>${due.fresh}</b><span>New · no due date</span></div>
<div class="sc due-today"><b>${due.today}</b><span>Due today</span></div>
<div class="sc due-overdue"><b>${due.overdue}</b><span>Overdue</span></div>
<div class="sc"><b>${reviewedToday}</b><span>Reviewed today</span></div>
<div class="sc"><b>${totalAll ? Math.round((100 * okAll) / totalAll) + "%" : "–"}</b><span>Not bad, ${range === 180 ? "6 months" : `${range} days`}</span></div>
</div>
<section class="box stat"><h2>Kanji by level</h2><div class="lg">${legend}</div>${areaChart(days, series, `Kanji by level over the last ${range} days`)}</section>
<section class="box stat"><h2>Coming up</h2><div class="lg"><span><b>${dueCount()}</b> due now:</span><span><i style="background:${DUE_COLORS.fresh}"></i>New, no due date ${due.fresh}</span><span><i style="background:${DUE_COLORS.today}"></i>Due today ${due.today}</span><span><i style="background:${DUE_COLORS.overdue}"></i>Overdue ${due.overdue}</span><span>then kanji already scheduled:</span></div>${barChart(["Now", ...fDays.map((_, i) => `+${i + 1}`)], [nowBar, ...comingBars], [`Now: ${due.fresh} with no due date, ${due.today} due today, ${due.overdue} overdue`, ...comingTitles], "Due kanji now (no due date, due today, overdue) and kanji already scheduled for each of the next 14 days")}</section>
<section class="box stat"><h2>Answers by level</h2><div class="lg"><span><i style="background:#e34948"></i>Bad</span><span><i style="background:#9CA3AF"></i>Neutral</span><span><i style="background:#2a78d6"></i>Good</span><span><i style="background:#1baf7a"></i>Easy</span></div>
<div class="tbw"><table class="at"><tr><th>Level</th><th>Interval</th><th class="num">Reviews</th><th>Answers</th><th class="num">Not bad</th><th>Verdict</th></tr>${tableRows}</table></div></section>`;
    return html(layout("Stats – Kanji", "", body, "stats"));
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not build the stats: ${esc((e as Error).message)}.</div>`), 500);
  }
}

// ---------- server ----------
const STATIC_FILES: Record<string, [string, string]> = {
  "/styles.css": ["public/styles.css", "text/css; charset=utf-8"],
  "/js/layout.js": ["public/js/layout.js", "text/javascript; charset=utf-8"],
  "/js/story-editor.js": ["public/js/story-editor.js", "text/javascript; charset=utf-8"],
  "/js/review-keys.js": ["public/js/review-keys.js", "text/javascript; charset=utf-8"],
};

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const asset = STATIC_FILES[url.pathname];
    if (asset) return new Response(Bun.file(asset[0]), { headers: { "content-type": asset[1], "cache-control": "no-cache" } });

    if (url.pathname.startsWith("/fonts/")) {
      // the Jigmo files live in public/fonts; only those exact names are served
      const name = url.pathname.slice("/fonts/".length);
      if (!/^Jigmo\d*\.ttf$/.test(name)) return new Response("Not found", { status: 404 });
      const file = Bun.file(`public/fonts/${name}`);
      if (!(await file.exists())) return new Response("Not found", { status: 404 });

      return new Response(file, {
        headers: {
          "Content-Type": "font/ttf",
          "Access-Control-Allow-Origin": "*", // allows the tablet to download it
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    return requestContext.run({ theme: themeFrom(req), detailsOpen: detailsOpenFrom(req), back: url.pathname + url.search }, async () => {
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { return html(layout("Bad request", "", `<div class="box empty">Bad request.</div>`), 400); }

      if (path === "/details/toggle") return req.method === "POST" ? toggleDetails(req) : new Response("Method not allowed", { status: 405 });
      if (path === "/theme") return req.method === "POST" ? setTheme(req) : new Response("Method not allowed", { status: 405 });
      if (path === "/stats") return statsPage(url);
      if (path === "/settings/reset-scores") return req.method === "POST" ? resetScores(req) : new Response("Method not allowed", { status: 405 });
      if (path === "/settings") return req.method === "POST" ? saveSettings(req, url) : settingsPage(url);
      if (path === "/review") return reviewNext();
      const reviewShow = path.match(/^\/review\/([^/]+)$/);
      if (reviewShow) return reviewPage(reviewShow[1]);
      const reviewDone = path.match(/^\/review\/([^/]+)\/(good|neutral|bad|easy)$/);
      if (reviewDone) {
        return req.method === "POST" ? reviewResult(req, reviewDone[1], reviewDone[2] as ReviewResult) : new Response("Method not allowed", { status: 405 });
      }
      const kanjiToggle = path.match(/^\/kanji\/([^/]+)\/toggle$/);
      if (kanjiToggle) {
        return req.method === "POST" ? toggleKanji(req, kanjiToggle[1]) : new Response("Method not allowed", { status: 405 });
      }
      const kanjiImage = path.match(/^\/kanji\/([^/]+)\/image(\/delete)?$/);
      if (kanjiImage) {
        if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
        return kanjiImage[2] ? deleteImage(req, kanjiImage[1]) : uploadImage(req, kanjiImage[1]);
      }
      const kanjiEdit = path.match(/^\/kanji\/([^/]+)\/edit$/);
      if (kanjiEdit) {
        return req.method === "POST" ? updateKanji(req, kanjiEdit[1]) : new Response("Method not allowed", { status: 405 });
      }
      const toggle = path.match(/^\/words\/(\d+)\/toggle$/);
      if (toggle) {
        return req.method === "POST" ? toggleWord(req, Number(toggle[1])) : new Response("Method not allowed", { status: 405 });
      }
      if (path === "/") return home(url);
      if (path === "/my-list") return myListPage(url);
      if (path === "/jlpt") return levelPage("jlpt", "JLPT", "jlpt");
      if (path === "/kanken") return levelPage("kanken", "KANKEN", "kanken");
      if (path.startsWith("/kanji/")) return kanjiPage(path.slice(7), url);
      if (path.startsWith("/img/")) {
        const f = await findImage(path.slice(5));
        return f ? new Response(f, { headers: { "cache-control": "no-cache" } }) : new Response("Not found", { status: 404 });
      }
      return html(layout("Not found", "", `<div class="box empty">Page not found.</div>`), 404);
    });
  },
});

console.log(`Kanji app running at http://localhost:${PORT}`);