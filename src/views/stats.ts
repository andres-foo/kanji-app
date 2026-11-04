import { db } from "../db";
import { esc, html } from "../html";
import { MAX_SCORE, MIN_SCORE, masteryLevels } from "../mastery";
import { dueCount, dueCounts, type ReviewResult } from "../review";
import { startScore } from "../settings";
import { addDays, STAT_RANGES, verdict } from "../stats";
import { areaChart, barChart, BLUES } from "./charts";
import { layout } from "./layout";

// the three due states: green = no due date yet (new), blue = due today, red = overdue
const DUE_COLORS = { fresh: "#16A34A", today: "#2a78d6", overdue: "#DC2626" } as const;

export function statsPage(url: URL) {
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
