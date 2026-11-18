import { db } from "../db";
import { enc, esc } from "../html";
import { historyLimit, kanjiHistory, searchHistory } from "../history";
import { dueCounts } from "../review";
import { addDays } from "../stats";
import { keywordText } from "./shared";
import { statsSection } from "./stats-section";

const ANSWER_TYPES = `type IN ('bad', 'neutral', 'good', 'easy')`;
const REVIEW_LABEL: Record<string, string> = { bad: "Bad", neutral: "Neutral", good: "Good", easy: "Easy" };
const number = (n: number) => n.toLocaleString("en-US");
const heatLevel = (n: number) => n <= 0 ? 0 : n <= 20 ? 1 : n <= 40 ? 2 : n <= 60 ? 3 : 4;

const kpi = (value: string, label: string, sub = "") =>
  `<div class="card dashkpi"><b>${value}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ""}</div>`;

// every day of the last year, coloured by how many kanji were reviewed
const heatmapCard = (today: string) => {
  const windowStart = addDays(today, -364);
  const startDow = (new Date(`${windowStart}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(windowStart, -startDow);
  const rows = db.query(`SELECT date(date) AS d, COUNT(DISTINCT kanji) AS n
    FROM review_history WHERE ${ANSWER_TYPES} AND date(date) >= ?
    GROUP BY d`).all(start) as { d: string; n: number }[];
  const byDay = new Map(rows.map((r) => [r.d, r.n]));
  const weeks: string[][] = [];
  let week: string[] = [];
  for (let day = start; day <= today; day = addDays(day, 1)) {
    const n = byDay.get(day) ?? 0;
    const label = n ? `${day}: ${n} kanji reviewed` : `${day}: no reviews`;
    week.push(`<span class="heatcell l${heatLevel(n)}" title="${esc(label)}" aria-label="${esc(label)}"></span>`);
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(`<span class="heatcell future" aria-hidden="true"></span>`);
    weeks.push(week);
  }
  return `<div class="card" style="grid-column:span 12">
    <div class="stathead"><div><h2>Review heatmap</h2><p class="sub">Kanjis reviewed per day · last year</p></div></div>
    <div class="heatmap-scroll">
      <div class="heatmap">
        <div class="heatdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
        <div class="heatweeks">${weeks.map((w) => `<div class="heatweek">${w.join("")}</div>`).join("")}</div>
      </div>
    </div>
    <div class="heatlegend">
      <span><i class="l0"></i>No reviews</span>
      <span><i class="l1"></i>≤20</span>
      <span><i class="l2"></i>≤40</span>
      <span><i class="l3"></i>≤60</span>
      <span><i class="l4"></i>60+</span>
    </div>
  </div>`;
};

export function dashboardView(days = 30, tab: "history" | "stats" = "stats") {
  const today = (db.query(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;
  const list = db.query(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN unfinished = 1 THEN 1 ELSE 0 END), 0) AS unfinished
    FROM kanjis WHERE COALESCE(added, 0) = 1`).get() as { total: number; unfinished: number };

  if (!list.total) {
    return {
      title: "Dashboard – Kanji",
      body: `<div class="listhead"><div><h1>Dashboard</h1><p class="sub">Your kanji at a glance.</p></div></div>
        <div class="card dashempty"><h2>Start your kanji list</h2><p class="sub">Use the search bar above to find a kanji, or browse a level to get going.</p><div class="dashactions"><a class="pill dark" href="/jlpt">Browse JLPT</a></div></div>`,
    };
  }

  const tabs = `<div class="viewtabs"><a class="viewtab${tab === "stats" ? " on" : ""}" href="/">Stats</a><a class="viewtab${tab === "history" ? " on" : ""}" href="/?tab=history">History</a></div>`;
  const header = `<div class="listhead"><div><h1>Dashboard</h1><p class="sub">Your kanji at a glance.</p></div>${tabs}</div>`;

  // the counters belong to the stats view
  if (tab === "stats") {
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
    const kpis = `<div class="dashkpis">
      ${kpi(number(dueTotal), "Due now", `<span class="due-fresh">${due.fresh}</span> new · <span class="due-today">${due.today}</span> today · <span class="due-overdue">${due.overdue}</span> overdue`)}
      ${kpi(number(reviewedToday), "Reviewed today", "Answers logged today")}
      ${kpi(number(streak), "Day streak", streak ? "Keep it going" : "Review to start")}
      ${kpi(number(list.total), "In your list", `${number(list.unfinished)} unfinished`)}
    </div>`;
    return { title: "Dashboard – Kanji", body: `${header}${kpis}<div class="grid">${heatmapCard(today)}</div>${statsSection(days)}` };
  }

  // nine tiles fill the three-column grid of a half-width card, so this card ends
  // level with the six review rows beside it
  const recentAdded = db.query(`SELECT literal, keyword, unfinished FROM kanjis WHERE COALESCE(added, 0) = 1
    ORDER BY COALESCE(added_at, '') DESC, literal LIMIT 9`).all() as { literal: string; keyword: string | null; unfinished: number | null }[];
  const recentReviews = db.query(`SELECT kanji, date, "before" AS b, "after" AS a, type FROM review_history
    WHERE ${ANSWER_TYPES} ORDER BY date DESC, id DESC LIMIT 6`).all() as { kanji: string; date: string; b: number; a: number; type: string }[];
  const limit = historyLimit();
  const searches = searchHistory(limit);
  const visited = kanjiHistory(limit);

  const addedTiles = recentAdded.map((k) => {
    const state = k.unfinished === 1 ? "unf" : "in";
    const label = state === "unf" ? "Unfinished" : "Finished";
    return `<a class="dashk-${state}" href="/kanji/${enc(k.literal)}" aria-label="${esc(k.literal)} — ${label}"><span class="dashk">${esc(k.literal)}</span><span class="dashkw">${esc(keywordText(k.keyword)) || "—"}</span></a>`;
  }).join("");
  const recent = `<div class="card" style="grid-column:span 6">
    <div class="stathead"><div><h2>Recently added</h2><p class="sub">Latest additions to your list</p></div></div>
    <div class="dashkanji">${addedTiles || `<div class="sub">No added kanji yet.</div>`}</div>
  </div>`;

  const reviewRows = recentReviews.map((r) => `<a class="dashreview" href="/kanji/${enc(r.kanji)}"><span class="dashreview-k">${esc(r.kanji)}</span><span class="dashreview-type ${r.type}">${REVIEW_LABEL[r.type] ?? r.type}</span><span class="dashreview-meta">${r.b} → ${r.a}</span><span class="dashreview-date">${esc(String(r.date).slice(5, 10))}</span></a>`).join("");
  const reviews = `<div class="card" style="grid-column:span 6">
    <div class="stathead"><div><h2>Recent reviews</h2><p class="sub">Your latest answers</p></div></div>
    <div class="dashreviews">${reviewRows || `<div class="sub" style="padding:8px 0">No reviews yet.</div>`}</div>
  </div>`;

  const searchChips = searches.length
    ? searches.map((q) => `<a class="historyquery" href="/?q=${enc(q)}">${esc(q)}</a>`).join("")
    : `<p class="sub historyempty">No searches yet.</p>`;
  const searchCard = `<div class="card" style="grid-column:span 6">
    <div class="stathead"><div><h2>Recent searches</h2><p class="sub">Click a query to search again</p></div></div>
    <div class="historysearches">${searchChips}</div>
  </div>`;

  const visitedTiles = visited.length
    ? `<div class="lgrid">${visited.map((k) => {
        const state = k.added === 1 ? (k.unfinished === 1 ? "unf" : "in") : "";
        return `<a class="lkt${state ? ` ${state}` : " notadded"}" href="/kanji/${enc(k.literal)}" aria-label="Open ${esc(k.literal)}">${esc(k.literal)}</a>`;
      }).join("")}</div>`
    : `<p class="sub historyempty">No kanji visits yet.</p>`;
  const visitedCard = `<div class="card" style="grid-column:span 6">
    <div class="stathead"><div><h2>Recently visited</h2><p class="sub">Kanji pages you opened</p></div></div>
    ${visitedTiles}
  </div>`;

  return { title: "Dashboard – Kanji", body: `${header}<div class="grid">${recent}${reviews}${searchCard}${visitedCard}</div>` };
}
