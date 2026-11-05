import { db } from "../db";
import { enc, esc } from "../html";
import { dueCounts } from "../review";
import { addDays } from "../stats";
import { keywordText } from "./shared";
import { statsSection } from "./stats-section";

const ANSWER_TYPES = `type IN ('bad', 'neutral', 'good', 'easy')`;
const REVIEW_LABEL: Record<string, string> = { bad: "Bad", neutral: "Neutral", good: "Good", easy: "Easy" };
const number = (n: number) => n.toLocaleString("en-US");

type Counts = { total: number; finished: number; unfinished: number };

const levelCounts = (column: "jlpt" | "kanken"): Counts =>
  db.query(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN COALESCE(added, 0) = 1 AND COALESCE(unfinished, 0) = 0 THEN 1 ELSE 0 END), 0) AS finished,
      COALESCE(SUM(CASE WHEN COALESCE(added, 0) = 1 AND unfinished = 1 THEN 1 ELSE 0 END), 0) AS unfinished
    FROM kanjis WHERE ${column} IS NOT NULL AND ${column} > 0`).get() as Counts;

const kpi = (value: string, label: string, sub = "") =>
  `<div class="card dashkpi"><b>${value}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ""}</div>`;

const progressRow = (label: string, href: string, finished: number, unfinished: number, total: number) => {
  const added = finished + unfinished;
  const fwidth = total ? (finished / total) * 100 : 0;
  const uwidth = total ? (unfinished / total) * 100 : 0;
  const pct = total ? Math.round((added / total) * 100) : 0;
  return `<a class="progressrow" href="${href}">
    <div class="progressname"><span>${label}</span><span>${pct}%</span></div>
    <div class="dashbar"><i class="fin" style="width:${fwidth}%"></i><i class="unf" style="width:${uwidth}%"></i></div>
    <div class="progressmeta"><span>${number(added)} of ${number(total)} added</span><span>${number(unfinished)} unfinished</span></div>
  </a>`;
};

export function dashboardView(days = 30) {
  const today = (db.query(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;
  const list = db.query(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN unfinished = 1 THEN 1 ELSE 0 END), 0) AS unfinished
    FROM kanjis WHERE COALESCE(added, 0) = 1`).get() as { total: number; unfinished: number };

  if (!list.total) {
    return {
      title: "Dashboard – Kanji",
      body: `<div class="listhead"><div><h1>Dashboard</h1><p class="sub">Your kanji at a glance.</p></div></div>
        <div class="card dashempty"><h2>Start your kanji list</h2><p class="sub">Use the search bar above to find a kanji, or browse a level to get going.</p><div class="dashactions"><a class="pill dark" href="/jlpt">Browse JLPT</a><a class="pill ghost" href="/kanken">Browse Kanken</a></div></div>`,
    };
  }

  const due = dueCounts();
  const dueTotal = due.fresh + due.today + due.overdue;
  const reviewedToday = (db.query(`SELECT COUNT(*) AS n FROM review_history WHERE ${ANSWER_TYPES} AND date(date) = ?`).get(today) as { n: number }).n;

  const reviewDates = new Set((db.query(`SELECT DISTINCT date(date) AS d FROM review_history WHERE ${ANSWER_TYPES} ORDER BY d DESC LIMIT 400`).all() as { d: string }[]).map((r) => r.d));
  let cursor = today;
  if (!reviewDates.has(cursor)) cursor = addDays(today, -1);
  let streak = 0;
  while (reviewDates.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  const jlpt = levelCounts("jlpt");
  const kanken = levelCounts("kanken");

  const recentAdded = db.query(`SELECT literal, keyword, unfinished FROM kanjis WHERE COALESCE(added, 0) = 1
    ORDER BY COALESCE(added_at, '') DESC, literal LIMIT 6`).all() as { literal: string; keyword: string | null; unfinished: number | null }[];
  const recentReviews = db.query(`SELECT kanji, date, "before" AS b, "after" AS a, type FROM review_history
    WHERE ${ANSWER_TYPES} ORDER BY date DESC, id DESC LIMIT 6`).all() as { kanji: string; date: string; b: number; a: number; type: string }[];

  const header = `<div class="listhead"><div><h1>Dashboard</h1><p class="sub">Your kanji at a glance.</p></div></div>`;
  const kpis = `<div class="dashkpis">
    ${kpi(number(dueTotal), "Due now", `<span class="due-fresh">${due.fresh}</span> new · <span class="due-today">${due.today}</span> today · <span class="due-overdue">${due.overdue}</span> overdue`)}
    ${kpi(number(reviewedToday), "Reviewed today", "Answers logged today")}
    ${kpi(number(streak), "Day streak", streak ? "Keep it going" : "Review to start")}
    ${kpi(number(list.total), "In your list", `${number(list.unfinished)} unfinished`)}
  </div>`;

  const progress = `<div class="card dashprogress" style="grid-column:span 5">
    <div class="stathead"><div><h2>Progress</h2><p class="sub">Kanjis added</p></div><div class="progresslegend"><span><i class="fin"></i>Finished</span><span><i class="unf"></i>Unfinished</span><span><i class="rest"></i>Not added</span></div></div>
    ${progressRow("JLPT", "/jlpt", jlpt.finished, jlpt.unfinished, jlpt.total)}
    ${progressRow("Kanken", "/kanken", kanken.finished, kanken.unfinished, kanken.total)}
  </div>`;

  const addedTiles = recentAdded.map((k) => {
    const state = k.unfinished === 1 ? "unf" : "in";
    const label = state === "unf" ? "Unfinished" : "Finished";
    return `<a href="/kanji/${enc(k.literal)}"><span class="dashk">${esc(k.literal)}</span><span class="dashkw">${esc(keywordText(k.keyword)) || "—"}</span><i class="sdot ${state}" role="img" aria-label="${label}" title="${label}"></i></a>`;
  }).join("");
  const recent = `<div class="card" style="grid-column:span 7">
    <div class="stathead"><div><h2>Recently added</h2><p class="sub">Latest additions to your list</p></div><a class="pill ghost sm" href="/my-list">My List</a></div>
    <div class="dashkanji">${addedTiles || `<div class="sub">No added kanji yet.</div>`}</div>
  </div>`;

  const reviewRows = recentReviews.map((r) => `<a class="dashreview" href="/kanji/${enc(r.kanji)}"><span class="dashreview-k">${esc(r.kanji)}</span><span class="dashreview-type ${r.type}">${REVIEW_LABEL[r.type] ?? r.type}</span><span class="dashreview-meta">${r.b} → ${r.a}</span><span class="dashreview-date">${esc(String(r.date).slice(5, 10))}</span></a>`).join("");
  const reviews = `<div class="card" style="grid-column:span 12">
    <div class="stathead"><div><h2>Recent reviews</h2><p class="sub">Your latest answers</p></div></div>
    <div class="dashreviews">${reviewRows || `<div class="sub" style="padding:8px 0">No reviews yet.</div>`}</div>
  </div>`;

  return { title: "Dashboard – Kanji", body: `${header}${kpis}<div class="grid">${progress}${recent}${reviews}</div>${statsSection(days)}` };
}
