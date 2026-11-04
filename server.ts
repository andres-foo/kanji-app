import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? "./data/kanji.db";
const IMAGES_DIR = process.env.IMAGES_DIR ?? "./data/images";

// Opened read-write: writes are the add/remove toggles, the kanji edit form and image upload/removal (IMAGES_DIR must be writable too).
const db = new Database(DB_PATH, { readwrite: true });

// ---------- settings (table `settings`: key / value) ----------
// values are stored as text; a missing row, an unreadable table or a non-numeric value falls back to the default
const SETTING_DEFAULTS = {
  review_score_ceiling: 10, // a kanji's score never goes above this (the scale itself is -3 to 10)
  review_score_floor: -3, // ... or below this
  review_score_start: 0, // score given to a kanji the moment it is added, and the value "reset scores" sets
  review_delta_bad: -3,
  review_delta_neutral: 0,
  review_delta_good: 1,
  review_delta_easy: 2,
} as const;
type SettingKey = keyof typeof SETTING_DEFAULTS;

function setting(key: SettingKey): number {
  try {
    const row = db.query(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string | null } | null;
    const text = String(row?.value ?? "").trim();
    const n = Number(text);
    return text !== "" && Number.isFinite(n) ? n : SETTING_DEFAULTS[key];
  } catch {
    return SETTING_DEFAULTS[key];
  }
}

// ---------- mastery levels (table `mastery_levels`: score / label / interval_days) ----------
// the score decides how many days pass until the kanji is due again. A missing row, an invalid row or a missing
// table falls back to the built-in default for that score, so a review never fails because of it.
const MAX_SCORE = 10;
const MIN_SCORE = -3; // the bottom "Weak" levels sit below New (0)
// the answer buttons shown on the answer page, in order (the id is the review type saved in review_history)
const REVIEW_BUTTONS = [["bad", "Bad"], ["neutral", "Neutral"], ["good", "Good"], ["easy", "Easy"]] as const;
// the keyboard shortcut for each of those answers, in the same order (Space shows the answer)
const REVIEW_KEYS = ["A", "S", "D", "F"] as const;
// the gamepad shoulder/trigger hint for each answer, in the same order (A shows the answer)
const REVIEW_PAD = ["LT", "LB", "RB", "RT"] as const;
type Mastery = { score: number; label: string; interval_days: number };
const MASTERY_DEFAULTS: Mastery[] = [
  { score: -3, label: "Weak", interval_days: 1 },
  { score: -2, label: "Weak", interval_days: 1 },
  { score: -1, label: "Weak", interval_days: 1 },
  { score: 0, label: "New", interval_days: 1 },
  { score: 1, label: "Learning", interval_days: 1 },
  { score: 2, label: "Learning", interval_days: 2 },
  { score: 3, label: "Learning", interval_days: 3 },
  { score: 4, label: "Familiar", interval_days: 4 },
  { score: 5, label: "Familiar", interval_days: 6 },
  { score: 6, label: "Familiar", interval_days: 8 },
  { score: 7, label: "Strong", interval_days: 12 },
  { score: 8, label: "Strong", interval_days: 16 },
  { score: 9, label: "Strong", interval_days: 20 },
  { score: 10, label: "Mastered", interval_days: 25 },
];

function masteryLevels(): Mastery[] {
  const levels = new Map(MASTERY_DEFAULTS.map((m) => [m.score, m]));
  try {
    for (const r of db.query(`SELECT score, label, interval_days FROM mastery_levels`).all() as Mastery[]) {
      const score = Number(r.score);
      const days = Math.floor(Number(r.interval_days));
      if (Number.isInteger(score) && score >= MIN_SCORE && score <= MAX_SCORE && String(r.label ?? "").trim() && days >= 1) {
        levels.set(score, { score, label: String(r.label).trim(), interval_days: days });
      }
    }
  } catch {
    // table missing: the defaults above are used
  }
  return [...levels.values()].sort((a, b) => a.score - b.score);
}
const masteryFor = (score: number): Mastery => masteryLevels().find((m) => m.score === score) ?? MASTERY_DEFAULTS[0];

// lowest and highest score allowed: the settings, but never outside the -3 to 10 scale
function scoreBounds(): [number, number] {
  const a = setting("review_score_floor");
  const b = setting("review_score_ceiling");
  return [Math.max(MIN_SCORE, Math.min(a, b)), Math.min(MAX_SCORE, Math.max(a, b))];
}
const startScore = () => {
  const [lo, hi] = scoreBounds();
  return Math.min(hi, Math.max(lo, Math.round(setting("review_score_start"))));
};

type Kanji = {
  literal: string; meanings: string; onReadings: string | null; kunReadings: string | null;
  strokes: number | null; jlpt: number | null; frequency: number | null; grade: number | null;
  heisg6: number | null; components: string | null; other_forms: string | null;
  kanken: number | null; story: string | null; related: string | null; keyword: string | null;
  added: number | null; unfinished: number | null; is_component: number | null;
  score?: number | null; last_reviewed?: string | null; due_date?: string | null;
};
type Word = {
  id: number; kanji: string | null; kana: string | null; meanings: string | null;
  freq_wiki: number | null; added: number | null; jlpt: number | null; kanji_alternative: string | null;
};

// ---------- helpers ----------
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const likeEsc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const toKata = (s: string) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const toHira = (s: string) => s.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// ---------- study priority (depends on how many kanji are added) ----------
type Priority = "high" | "medium" | "low" | "zero";
// every kanji with added = 1 (unlike totalKnown, which only counts finished non-component ones)
const addedCount = () => (db.query(`SELECT COUNT(*) AS n FROM kanjis WHERE COALESCE(added, 0) = 1`).get() as { n: number }).n;
// the review queue split by due state: never scheduled at all (no due date), due today, or overdue.
// due_date is a YYYY-MM-DD text date, so comparing it to date('now', 'localtime') is a plain string comparison.
// An empty string is treated like NULL: the app never writes one, but a manual edit could.
type DueCounts = { fresh: number; today: number; overdue: number };
const EMPTY_DUE_COUNTS: DueCounts = { fresh: 0, today: 0, overdue: 0 }; // e.g. the due_date column does not exist yet
const dueCounts = (): DueCounts => {
  try {
    const row = db.query(
      `SELECT
         SUM(CASE WHEN due_date IS NULL OR TRIM(due_date) = '' THEN 1 ELSE 0 END) AS fresh,
         SUM(CASE WHEN due_date = date('now', 'localtime') THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN due_date < date('now', 'localtime') THEN 1 ELSE 0 END) AS overdue
       FROM kanjis WHERE COALESCE(added, 0) = 1`,
    ).get() as Partial<DueCounts> | null;
    return { fresh: row?.fresh ?? 0, today: row?.today ?? 0, overdue: row?.overdue ?? 0 };
  } catch {
    return EMPTY_DUE_COUNTS; // never break every page because of a counter
  }
};
// kanji in the study list that can be reviewed now: never scheduled, due today, or overdue
const dueCount = () => {
  const d = dueCounts();
  return d.fresh + d.today + d.overdue;
};
// the navbar counter: the queue size split into its three due states, each number in its own colour
const dueNumber = (value: number, cls: string, label: string) =>
  `<span class="rn ${cls}" title="${value} ${label}">${value}</span>`;
const reviewNavButton = () => {
  const d = dueCounts();
  const total = d.fresh + d.today + d.overdue;
  return `<a class="reviewbtn small" href="/review" aria-label="Review: ${total} due (${d.fresh} new, ${d.today} due today, ${d.overdue} overdue)">Review (${dueNumber(d.fresh, "rn-fresh", "with no due date")}<span class="rnsep" aria-hidden="true">·</span>${dueNumber(d.today, "rn-today", "due today")}<span class="rnsep" aria-hidden="true">·</span>${dueNumber(d.overdue, "rn-overdue", "overdue")})</a>`;
};
const totalKnown = () => (db.query(`SELECT COUNT(*) AS n FROM kanjis WHERE COALESCE(added, 0) = 1 AND is_component IS NULL AND COALESCE(unfinished, 0) = 0`).get() as { n: number }).n;

// each level is "high" once it is within the accumulated range, the next level is "medium", the rest "low"
// (the very last tier, where only the hardest levels remain, is "medium" for everything left)
const jlptPriority = (jlpt: number, total: number): Priority => {
  if (jlpt === 5) return "high";
  const levels = [5, 4, 3, 2, 1];
  const t = [80, 247, 617, 985];
  for (let i = 0; i < t.length; i++) {
    if (total < t[i]) {
      const idx = levels.includes(jlpt) ? levels.indexOf(jlpt) : levels.length;
      if (idx <= i) return "high";
      if (idx === i + 1) return "medium";
      return i === 3 ? "medium" : "low";
    }
  }
  return "high";
};

const kankenPriority = (kanken: number, total: number): Priority => {
  if (kanken === 10) return "high";
  if (kanken === 1.5 || kanken === 1) return "zero";
  const levels = [10, 9, 8, 7, 6, 5, 4, 3, 2.5, 2, 1.5, 1];
  const t = [80, 240, 440, 642, 835, 1026, 1339, 1623, 1951];
  for (let i = 0; i < t.length; i++) {
    if (total < t[i]) {
      const idx = levels.includes(kanken) ? levels.indexOf(kanken) : levels.length;
      if (idx <= i) return "high";
      if (idx === i + 1) return "medium";
      return i === 8 ? "medium" : "low";
    }
  }
  return "high";
};

const jlptBadge = (k: Pick<Kanji, "jlpt">, total: number) =>
  k.jlpt ? `<span class="b priority-${jlptPriority(Number(k.jlpt), total)}">N${esc(k.jlpt)}</span>` : "";
const kankenBadge = (k: Pick<Kanji, "kanken">, total: number, label = "Kanken ") =>
  k.kanken ? `<span class="b priority-${kankenPriority(Number(k.kanken), total)}">${label}${esc(k.kanken)}</span>` : "";
// the database separates meanings with ";": show them separated by commas
const meaningsList = (s: unknown) => String(s ?? "").split(";").map((m) => m.trim()).filter(Boolean);
// synonyms after a numbered definition stay on its line until the next (n) marker
const meaningGroups = (s: unknown) => {
  const groups: string[] = [];
  const startsDefinition = /^(?:\([^)]*\)\s*)?\(\d+\)(?:\s|$)/;
  for (const part of meaningsList(s)) {
    if (part === "(P)") continue;
    if (!groups.length || startsDefinition.test(part)) groups.push(part);
    else groups[groups.length - 1] += `, ${part}`;
  }
  return groups;
};
const meaningsText = (s: unknown) => meaningsList(s).join(", ");
const meanings = (s: unknown) => esc(meaningsText(s));
const readingList = (s: string | null) => (s ? s.split(/[、,;\s]+/).filter(Boolean).join("、") : "");
const keywordText = (s: string | null) => (s ? s.split(";").map((k) => k.trim()).filter(Boolean).join(", ") : "");
const splitKanjiMarker = (kanji: string) => {
  const match = /^(.*?)\s*(\([^)]*\))$/.exec(kanji);
  return match ? { text: match[1].trim(), marker: match[2] } : { text: kanji, marker: "" };
};
const nullsLast = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);
const enc = encodeURIComponent;

const SEARCH_MIN = 2;
const singleCjk = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;
const shortQuery = (q: string) => [...q].length < SEARCH_MIN && !singleCjk.test(q);
const regexEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const highlight = (text: string | null | undefined, q: string) => {
  const value = String(text ?? "");
  const needles = [...new Set([q, toHira(q), toKata(q)].filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!value || !needles.length) return esc(value);
  let re: RegExp;
  try { re = new RegExp(needles.map(regexEsc).join("|"), "giu"); } catch { return esc(value); }
  let out = "";
  let last = 0;
  for (const match of value.matchAll(re)) {
    const i = match.index ?? 0;
    out += esc(value.slice(last, i)) + `<mark>${esc(match[0])}</mark>`;
    last = i + match[0].length;
  }
  return out + esc(value.slice(last));
};

// Story markup: =keyword=  _component_  ?note?  #link#  (markers may nest, except inside a link).
// Works on the raw text and escapes every piece, so the "#" in HTML entities can never be mistaken for a marker.
const STORY_MARKUP = /=([^=\n]+)=|_([^_\n]+)_|\?([^?\n]+)\?|#([^#\n]+)#/g;
function storyHtml(s: string): string {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(STORY_MARKUP)) {
    out += esc(s.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    if (m[1] !== undefined) out += `<span class="story_keyword">${storyHtml(m[1])}</span>`;
    else if (m[2] !== undefined) out += `<span class="story_component">${storyHtml(m[2])}</span>`;
    else if (m[3] !== undefined) out += `<span class="story_note">${storyHtml(m[3])}</span>`;
    else out += `<a class="story_link" href="/?q=${enc(m[4].trim())}">${esc(m[4])}</a>`;
  }
  return out + esc(s.slice(last));
}

// ---------- preferences ----------
type Theme = "light" | "dark";
type RequestContext = { theme: Theme | null; detailsOpen: boolean; back: string };
// Request-scoped so concurrent requests don't share the visitor's preferences.
const requestContext = new AsyncLocalStorage<RequestContext>();
const cookieValue = (req: Request, name: string) =>
  new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(req.headers.get("cookie") ?? "")?.[1] ?? null;
const themeFrom = (req: Request): Theme | null => {
  const value = cookieValue(req, "kanji_theme");
  return value === "light" || value === "dark" ? value : null;
};
const detailsOpenFrom = (req: Request) => cookieValue(req, "kanji_details") !== "closed";
const sameOrigin = (req: Request) => {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
};
const safeBack = (value: unknown) => {
  try {
    const url = new URL(String(value ?? "/"), "http://localhost");
    return url.origin === "http://localhost" ? url.pathname + url.search + url.hash : "/";
  } catch { return "/"; }
};

// ---------- romaji -> kana ----------
const KANA: Record<string, string> = {};
`a あ i い u う e え o お ka か ki き ku く ke け ko こ sa さ shi し si し su す se せ so そ
ta た chi ち ti ち tsu つ tu つ te て to と na な ni に nu ぬ ne ね no の ha は hi ひ fu ふ hu ふ he へ ho ほ
ma ま mi み mu む me め mo も ya や yu ゆ yo よ ra ら ri り ru る re れ ro ろ wa わ wo を
ga が gi ぎ gu ぐ ge げ go ご za ざ ji じ zi じ zu ず ze ぜ zo ぞ da だ di ぢ du づ de で do ど
ba ば bi び bu ぶ be べ bo ぼ pa ぱ pi ぴ pu ぷ pe ぺ po ぽ
kya きゃ kyu きゅ kyo きょ sha しゃ shu しゅ sho しょ sya しゃ syu しゅ syo しょ
cha ちゃ chu ちゅ cho ちょ cya ちゃ cyu ちゅ cyo ちょ tya ちゃ tyu ちゅ tyo ちょ
nya にゃ nyu にゅ nyo にょ hya ひゃ hyu ひゅ hyo ひょ mya みゃ myu みゅ myo みょ
rya りゃ ryu りゅ ryo りょ gya ぎゃ gyu ぎゅ gyo ぎょ ja じゃ ju じゅ jo じょ
jya じゃ jyu じゅ jyo じょ zya じゃ zyu じゅ zyo じょ dya ぢゃ dyu ぢゅ dyo ぢょ
bya びゃ byu びゅ byo びょ pya ぴゃ pyu ぴゅ pyo ぴょ fa ふぁ fi ふぃ fe ふぇ fo ふぉ je じぇ che ちぇ she しぇ`
  .split(/\s+/).forEach((t, i, a) => { if (i % 2 === 0) KANA[t] = a[i + 1]; });

/** Hepburn/Kunrei romaji to hiragana. Returns null unless the WHOLE text converts cleanly. */
function romajiToHiragana(input: string): string | null {
  const s = input.toLowerCase().replace(/\s+/g, "");
  if (!/^[a-z']+$/.test(s) || !/[a-z]/.test(s)) return null;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i], next = s[i + 1];
    if (c === "n" && next === "'") { out += "ん"; i += 2; continue; }
    if (c === "'") { i++; continue; }
    if (next === c && /[bcdfghjkmpqrstvwxyz]/.test(c)) { out += "っ"; i++; continue; }
    if (c === "t" && next === "c" && s[i + 2] === "h") { out += "っ"; i++; continue; }
    let hit = false;
    for (let len = 3; len >= 1 && !hit; len--) {
      const k = KANA[s.slice(i, i + len)];
      if (k && s.length >= i + len) { out += k; i += len; hit = true; }
    }
    if (hit) continue;
    if (c === "n" && (next === undefined || !/[aiueoy]/.test(next))) { out += "ん"; i++; continue; }
    if (c === "m" && (next === "b" || next === "p")) { out += "ん"; i++; continue; }
    return null;
  }
  return out;
}

// ---------- data ----------
function search(q: string) {
  const kana = [...new Set([toHira(q), toKata(q)])];
  const hasKana = /[\u3041-\u30ff]/.test(q);
  const lits = [...new Set(q.match(/\p{Script=Han}/gu) ?? [])].slice(0, 12);
  const pat = (s: string) => `%${likeEsc(s)}%`;

  // kanji: literal, keyword, meanings, on/kun readings (ignoring "." and "-" okurigana marks)
  const kc: string[] = [`CAST(meanings AS TEXT) LIKE ? ESCAPE '\\'`, `CAST(keyword AS TEXT) LIKE ? ESCAPE '\\'`];
  const kp: string[] = [pat(q), pat(q)];
  if (lits.length) { kc.push(`literal IN (${lits.map(() => "?").join(",")})`); kp.push(...lits); }
  if (hasKana) {
    for (const v of kana) {
      kc.push(`REPLACE(REPLACE(COALESCE(onReadings,'') || ' ' || COALESCE(kunReadings,''), '.', ''), '-', '') LIKE ? ESCAPE '\\'`);
      kp.push(pat(v));
    }
  }
  const kanji = (db.query(`SELECT * FROM kanjis WHERE ${kc.join(" OR ")}`).all(...kp) as Kanji[])
    .sort((a, b) =>
      Number(lits.includes(b.literal)) - Number(lits.includes(a.literal)) ||
      (b.jlpt ?? 0) - (a.jlpt ?? 0) ||
      nullsLast(a.frequency, b.frequency));

  // words: kanji, kana, meanings (+ alternative spellings)
  const wc = [`kanji LIKE ? ESCAPE '\\'`, `CAST(meanings AS TEXT) LIKE ? ESCAPE '\\'`, `kanji_alternative LIKE ? ESCAPE '\\'`];
  const wp = [pat(q), pat(q), pat(q)];
  for (const v of kana) { wc.push(`kana LIKE ? ESCAPE '\\'`); wp.push(pat(v)); }
  const exact = (w: Word) => w.kanji === q || (w.kana !== null && kana.includes(w.kana));
  const words = (db.query(`SELECT * FROM examples WHERE ${wc.join(" OR ")}`).all(...wp) as Word[])
    .sort((a, b) => Number(exact(b)) - Number(exact(a)) || nullsLast(a.freq_wiki, b.freq_wiki));

  return { kanji, words };
}

async function findImage(literal: string) {
  if ([...literal].length !== 1) return null;
  for (const ext of ["jpg", "png"]) {
    const f = Bun.file(join(IMAGES_DIR, `${literal}.${ext}`));
    if (await f.exists()) return f;
  }
  return null;
}

// ---------- html ----------
const gearIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
const sunIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const moonIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;

const themeButton = (theme: Theme, label: string, icon: string, back: string) => `
<form class="theme-f" method="post" action="/theme">
<input type="hidden" name="theme" value="${theme}">
<input type="hidden" name="back" value="${esc(back)}">
<button class="theme-btn to-${theme}" type="submit" aria-label="Switch to ${theme} theme" title="Switch to ${theme} theme">${icon}<span>${label}</span></button>
</form>`;

const themeToggle = (back: string) =>
  `<div class="themes">${themeButton("light", "Light", sunIcon, back)}${themeButton("dark", "Dark", moonIcon, back)}</div>`;

// dropdown with the three list pages: click or tap the label to open it (it also opens on hover where hovering exists).
// The label says "Lists" and only shows a list name, in the accent colour, while one of the list pages is open.
const listsMenu = (active: string) => {
  const items = [["my-list", `MY LIST (${addedCount()})`], ["jlpt", "JLPT"], ["kanken", "KANKEN"]] as const;
  const onList = items.some(([id]) => id === active);
  const current = items.find(([id]) => id === active) ?? items[0];
  const links = items.map(([id, label]) => `<a href="/${id}"${active === id ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("");
  // the label says "Lists" until you are on one of the list pages, then it shows that page's name in the accent colour
  return `<div class="dd"><button type="button" class="ddlabel${onList ? " on" : ""}" aria-haspopup="menu" aria-expanded="false">${onList ? current[1] : "Lists"}</button><div class="ddmenu"><nav class="ddbox" aria-label="Lists">${links}</nav></div></div>`;
};

const layout = (title: string, q: string, body: string, active = "", bar?: string) => {
  const ctx = requestContext.getStore();
  const theme = ctx?.theme;
  const back = ctx?.back ?? "/";
  return `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<script>try{if(localStorage.getItem("kanji_input")==="pad")document.documentElement.dataset.input="pad";}catch(e){}</script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;700&family=Nunito:wght@500;700;800;900&display=swap">
<link rel="stylesheet" href="/styles.css"></head><body>
<header>
<div class="navl">${listsMenu(active)}${reviewNavButton()}<a class="reviewbtn small${active === "stats" ? " on" : ""}" href="/stats">Stats</a></div>
<form class="s" action="/" method="get" role="search">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
<input name="q" value="${esc(q)}" placeholder="Kanji, keyword, meaning or reading" aria-label="Search" autocomplete="off" required ${shortQuery(q) && !bar ? "autofocus" : ""}>
${q ? `<a class="clear" href="/" aria-label="Clear search">×</a>` : ""}
</form><div class="hr">${themeToggle(back)}<a class="theme-btn" href="/settings" aria-label="Settings" title="Settings">${gearIcon}<span>Settings</span></a></div></header>
${bar ? `<div class="reviewbar">${bar}</div>` : ""}
<main>${body}</main>
${bar ? '<script src="/js/review-keys.js" defer></script>' : ""}
<script src="/js/layout.js" defer></script></body></html>`;
};

const html = (s: string, status = 200) =>
  new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const readingsRow = (k: Kanji, q: string) => {
  const on = readingList(k.onReadings);
  const kun = readingList(k.kunReadings);
  if (!on && !kun) return "";
  const part = (label: string, value: string) =>
    value ? `<span><span class="rlab">${label}</span>${highlight(value, q)}</span>` : "";
  return `<span class="readings">${part("On", on)}${part("Kun", kun)}</span>`;
};

const kanjiRow = (k: Kanji, q: string, total: number) => {
  const unfinished = k.added === 1 && k.unfinished === 1;
  return `
<div class="r${unfinished ? " unfinished" : k.added === 1 ? " in" : ""}">
<a class="rklink" href="/kanji/${enc(k.literal)}?q=${enc(q)}" aria-label="Open ${esc(k.literal)}"><span class="rk k">${esc(k.literal)}</span></a>
<span class="rm">${k.keyword ? `<span class="kw">${highlight(keywordText(k.keyword), q)}</span>` : ""}<span class="mean">${highlight(meaningsText(k.meanings), q)}</span>${readingsRow(k, q)}</span>
<span class="badges">${unfinished ? `<span class="sr">Unfinished</span>` : k.added === 1 ? `<span class="sr">In your study list</span>` : ""}${jlptBadge(k, total)}${kankenBadge(k, total)}</span></div>`;
};

const wordRow = (w: Word, back: string, q: string) => {
  const inList = w.added === 1;
  const { text: kanji, marker } = w.kanji ? splitKanjiMarker(w.kanji) : { text: "", marker: "" };
  const word = w.kanji
    ? `${kanji ? `<a class="wordlink" href="/?q=${enc(kanji)}" aria-label="Search for ${esc(kanji)}">${highlight(kanji, q)}</a>` : ""}${marker ? `<span class="kmarker">${esc(marker)}</span>` : ""}`
    : highlight(w.kana, q);
  return `
<div class="w${inList ? " in" : ""}" id="w${w.id}">
<div class="wtop">
<span class="k wk">${word}${w.kanji && w.kana ? `<span class="kana">「${highlight(w.kana, q)}」</span>` : ""}${w.kanji_alternative ? `<span class="alt">also ${highlight(w.kanji_alternative, q)}</span>` : ""}</span>
<span class="badges">${inList ? `<span class="sr">In your study list</span>` : ""}${w.jlpt ? `<span class="b">N${esc(w.jlpt)}</span>` : ""}${w.freq_wiki ? `<span class="b">#${esc(w.freq_wiki)}</span>` : ""}</span>
<form method="post" action="/words/${w.id}/toggle"><input type="hidden" name="back" value="${esc(back)}">
<button class="btn ${inList ? "rem" : "add"}" type="submit">${inList ? "Remove" : "Add"}</button></form>
</div>
<div class="wm">${meaningGroups(w.meanings).map((m) => `<span class="sense">${highlight(m, q)}</span>`).join("")}</div>
</div>`;
};

function suggestions(q: string, type: string) {
  const hira = romajiToHiragana(q);
  if (!hira) return "";
  const link = (label: string, tag: string, text: string) => shortQuery(text) ? "" :
    `<a class="sug" href="/?q=${enc(text)}&type=${type}"><span class="tag k">${tag}</span><span>${label}</span><span class="to k">${esc(text)}</span></a>`;
  const links = `${link("Search in hiragana", "あ", hira)}${link("Search in katakana", "ア", toKata(hira))}`;
  return links ? `<div class="sugs">${links}</div>` : "";
}

// one plain character tile linking to the kanji page; green when added, red when added but unfinished, no marking otherwise
const kanjiTile = (r: Pick<Kanji, "literal" | "added" | "unfinished">) => {
  const state = r.added === 1 ? (r.unfinished === 1 ? "unfinished" : "added") : "";
  const status = state === "unfinished" ? " (unfinished)" : state === "added" ? " (in your study list)" : "";
  return `<a class="kt k${state ? ` ${state}` : ""}" href="/kanji/${enc(r.literal)}" aria-label="Open ${esc(r.literal)}${status}">${esc(r.literal)}</a>`;
};
const countLabel = (n: number) => `<span class="cnt">(${n} ${n === 1 ? "character" : "characters"})</span>`;

// every kanji with a level in the given column, grouped by level (easiest first), shown as plain characters coloured by study state
function levelPage(column: "jlpt" | "kanken", label: string, active: string) {
  const rows = db.query(`SELECT literal, ${column} AS lvl, frequency, added, unfinished FROM kanjis WHERE ${column} IS NOT NULL AND ${column} > 0`)
    .all() as (Pick<Kanji, "literal" | "frequency" | "added" | "unfinished"> & { lvl: number })[];
  const levels = new Map<number, typeof rows>();
  for (const r of rows) levels.set(Number(r.lvl), [...(levels.get(Number(r.lvl)) ?? []), r]);
  // JLPT counts down from 5 to 1 and Kanken from 10 to 1, so the highest number is always the easiest level
  const sections = [...levels.keys()].sort((a, b) => b - a).map((lvl) => {
    const list = levels.get(lvl)!.sort((a, b) => nullsLast(a.frequency, b.frequency) || a.literal.localeCompare(b.literal));
    const tiles = list.map(kanjiTile).join("");
    return `<section><h2>${label} ${lvl}${countLabel(list.length)}</h2><div class="kgrid">${tiles}</div></section>`;
  });
  return html(layout(`${label} – Kanji`, "", `<h1>${label}</h1>` + (sections.join("") || `<div class="box empty">No kanji have a ${label} level.</div>`), active));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// every added kanji, grouped either by the month it was added (newest first) or by score (lowest first)
function myListPage(url: URL) {
  const by = url.searchParams.get("by") === "score" ? "score" : "date";
  const rows = db.query(`SELECT literal, added, unfinished, score, added_at, frequency FROM kanjis WHERE COALESCE(added, 0) = 1`)
    .all() as (Pick<Kanji, "literal" | "added" | "unfinished" | "frequency"> & { score: number | null; added_at: string | null })[];

  // group key -> { heading, sort position, kanji }; kanji without a date/score go in a last group
  const groups = new Map<string, { heading: string; order: number; list: typeof rows }>();
  const put = (key: string, heading: string, order: number, r: (typeof rows)[number]) => {
    const g = groups.get(key) ?? { heading, order, list: [] };
    g.list.push(r);
    groups.set(key, g);
  };
  for (const r of rows) {
    if (by === "date") {
      const m = /^(\d{4})-(\d{2})/.exec(String(r.added_at ?? ""));
      if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) put(`${m[1]}-${m[2]}`, `${MONTHS[Number(m[2]) - 1]} ${m[1]}`, -(Number(m[1]) * 12 + Number(m[2])), r);
      else put("none", "No date", Infinity, r);
    } else if (r.score === null || r.score === undefined) put("none", "No score", Infinity, r);
    else put(`s${r.score}`, `Score ${r.score}`, Number(r.score), r);
  }
  const addedAt = (r: (typeof rows)[number]) => String(r.added_at ?? "");
  const sections = [...groups.values()].sort((a, b) => a.order - b.order).map((g) => {
    g.list.sort((a, b) => (by === "date" ? addedAt(b).localeCompare(addedAt(a)) : 0) || nullsLast(a.frequency, b.frequency) || a.literal.localeCompare(b.literal));
    return `<section><h2>${esc(g.heading)}${countLabel(g.list.length)}</h2><div class="kgrid">${g.list.map(kanjiTile).join("")}</div></section>`;
  });
  const pill = (id: string, text: string) => `<a class="pill${by === id ? " on" : ""}" href="/my-list?by=${id}">${text}</a>`;
  const unfinishedCount = rows.filter((r) => r.unfinished === 1).length;
  const summary = rows.length
    ? `<p class="summary"><b class="fin">${rows.length - unfinishedCount}</b> finished, <b class="unfin">${unfinishedCount}</b> unfinished</p>`
    : "";
  const body = `<h1>MY LIST (${rows.length})</h1>${summary}<div class="pills">${pill("date", "By date added")}${pill("score", "By score")}</div>`
    + (sections.join("") || `<div class="box empty">No kanji in your list yet.</div>`);
  return html(layout("My list – Kanji", "", body, "my-list"));
}

function home(url: URL) {
  const raw = url.searchParams.get("q");
  const q = (raw ?? "").trim().slice(0, 100);
  const t = url.searchParams.get("type");
  const type = t === "kanji" || t === "words" ? t : "all";
  if (!q) return html(layout("Kanji", "", `<div class="box empty">${raw === null ? "Search by kanji, keyword, meaning, reading, or romaji." : "Enter at least two characters to search."}</div>`));
  if (shortQuery(q)) return html(layout("Search", q, `<div class="box empty">Enter at least two characters to search.</div>`));

  const { kanji, words } = search(q);
  const back = `/?q=${enc(q)}&type=${type}`;
  const pill = (id: string, label: string) =>
    `<a class="pill${type === id ? " on" : ""}" href="/?q=${enc(q)}&type=${id}">${label}</a>`;
  let body = suggestions(q, type);
  body += `<div class="pills">${pill("all", `All ${kanji.length + words.length}`)}${pill("kanji", `Kanji ${kanji.length}`)}${pill("words", `Words ${words.length}`)}</div>`;
  if (type !== "words" && kanji.length)
    body += `<section><h2>Kanji</h2><div class="box">${(() => { const total = totalKnown(); return kanji.map((k) => kanjiRow(k, q, total)).join(""); })()}</div></section>`;
  if (type !== "kanji" && words.length)
    body += `<section><h2>Words</h2><div class="box">${words.map((w) => wordRow(w, back, q)).join("")}</div></section>`;
  if (!kanji.length && !words.length) body += `<div class="box empty">Nothing found for “${esc(q)}”. Try another spelling or a shorter search.</div>`;
  return html(layout(`${q} – Kanji`, q, body));
}

// link every character of a field that is itself a kanji in the database
function linkKanji(s: string | null, q: string) {
  const chars = [...new Set(s?.match(/\p{Script=Han}/gu) ?? [])];
  if (!chars.length) return s ? esc(s) : "–";
  const found = new Set(
    (db.query(`SELECT literal FROM kanjis WHERE literal IN (${chars.map(() => "?").join(",")})`).all(...chars) as { literal: string }[]).map((r) => r.literal),
  );
  return chars.map((c) => found.has(c)
    ? `<a class="kl k" href="/kanji/${enc(c)}?q=${enc(q)}">${esc(c)}</a>` : `<span class="kl k">${esc(c)}</span>`).join("");
}

const plain = (v: unknown) => (v ? esc(v) : "–");
const readings = (s: string | null) => { const value = readingList(s); return value ? esc(value) : "–"; };

// example words containing the kanji: added ones first, then words with a jlpt level or wiki frequency;
// the rest are hidden behind a toggle (a native <details>, so no JavaScript is needed)
function exampleWords(literal: string, back: string) {
  const pat = `%${likeEsc(literal)}%`;
  const words = db.query(`SELECT * FROM examples WHERE kanji LIKE ? ESCAPE '\\' OR kanji_alternative LIKE ? ESCAPE '\\'`).all(pat, pat) as Word[];
  if (!words.length) return "";
  const rank = (w: Word) => (w.added === 1 ? 0 : w.jlpt || w.freq_wiki || w.kanji?.includes("(P)") ? 1 : 2);
  words.sort((a, b) => rank(a) - rank(b) || nullsLast(a.freq_wiki || null, b.freq_wiki || null) || (b.jlpt ?? 0) - (a.jlpt ?? 0));

  const button = (w: Word) => {
    const added = w.added === 1;
    const target = (w.kanji ? splitKanjiMarker(w.kanji).text : "") || w.kana || "";
    const label = w.kanji || w.kana || "";
    const face = `<span class="k">${esc(label)}</span>${w.jlpt ? `<span class="b">N${esc(w.jlpt)}</span>` : ""}${w.freq_wiki ? `<span class="b">#${esc(w.freq_wiki)}</span>` : ""}`;
    const toggle = `<form method="post" action="/words/${w.id}/toggle"><input type="hidden" name="back" value="${esc(back)}"><button class="btn ${added ? "rem" : "add"}" type="submit">${added ? "Remove" : "Add"}</button></form>`;
    const tip = `<div class="tip"><div class="tipbox"><div class="tiptop"><span class="k wk"><a class="wlink" href="/?q=${enc(target)}" aria-label="Search for ${esc(target)}">${esc(label)}</a>${w.kanji && w.kana ? `<span class="kana">「${esc(w.kana)}」</span>` : ""}${w.kanji_alternative ? `<span class="alt">also ${esc(w.kanji_alternative)}</span>` : ""}</span>${toggle}</div><span class="wm">${meaningGroups(w.meanings).map((m) => `<span class="sense">${esc(m)}</span>`).join("")}</span></div></div>`;
    return `<div class="exw" id="w${w.id}"><a class="ex${added ? " added" : ""}" href="/?q=${enc(target)}" aria-label="Search for ${esc(target)}${added ? " (in your study list)" : ""}">${face}</a>${tip}</div>`;
  };

  const shown = words.filter((w) => rank(w) < 2);
  const hidden = words.filter((w) => rank(w) === 2);
  return `<div class="examples">
<div class="ex-head">Examples</div>
${shown.length ? `<div class="exs">${shown.map(button).join("")}</div>` : ""}
${hidden.length ? `<details class="exmore"><summary><span class="s-closed">Show ${hidden.length} more</span><span class="s-open">Hide ${hidden.length} more</span></summary><div class="exs">${hidden.map(button).join("")}</div></details>` : ""}
</div>`;
}

// every other kanji that lists this one as a component, as links to those kanji (green/red border when added/unfinished)
function componentOf(literal: string, q: string) {
  const rows = db.query(`SELECT literal, keyword, jlpt, frequency, added, unfinished FROM kanjis WHERE components LIKE ? ESCAPE '\\' AND literal != ?`)
    .all(`%${likeEsc(literal)}%`, literal) as Pick<Kanji, "literal" | "keyword" | "jlpt" | "frequency" | "added" | "unfinished">[];
  if (!rows.length) return "";
  rows.sort((a, b) => (b.jlpt ?? 0) - (a.jlpt ?? 0) || nullsLast(a.frequency, b.frequency));
  const buttons = rows.map((r) => {
    const state = r.added === 1 ? (r.unfinished === 1 ? "unfinished" : "added") : "";
    const kw = keywordText(r.keyword);
    const status = state === "unfinished" ? " (unfinished)" : state === "added" ? " (in your study list)" : "";
    return `<a class="comp${state ? ` ${state}` : ""}" href="/kanji/${enc(r.literal)}${q ? `?q=${enc(q)}` : ""}" aria-label="Open ${esc(r.literal)}${kw ? ` (${esc(kw)})` : ""}${status}"><span class="k">${esc(r.literal)}</span>${kw ? `<span class="ckw">${esc(kw)}</span>` : ""}</a>`;
  });
  return `<div class="examples">
<div class="ex-head">Component for:</div>
<div class="exs">${buttons.join("")}</div>
</div>`;
}

// one button per component character: a link to its own kanji page when it is a kanji in the database,
// otherwise (e.g. a radical that is not in the database) a search for it; shows its keyword when it has one
function componentButtons(s: string | null, q = "") {
  const chars = [...new Set([...(s ?? "")].filter((c) => !/[\s,、;；，]/.test(c)))];
  if (!chars.length) return "";
  const keywords = new Map(
    (db.query(`SELECT literal, keyword FROM kanjis WHERE literal IN (${chars.map(() => "?").join(",")})`).all(...chars) as { literal: string; keyword: string | null }[])
      .map((r) => [r.literal, keywordText(r.keyword)]),
  );
  const buttons = chars.map((c) => {
    const kw = keywords.get(c);
    const inDb = keywords.has(c);
    const href = inDb ? `/kanji/${enc(c)}${q ? `?q=${enc(q)}` : ""}` : `/?q=${enc(c)}`;
    return `<a class="comp" href="${href}" aria-label="${inDb ? "Open" : "Search for"} ${esc(c)}${kw ? ` (${esc(kw)})` : ""}"><span class="k">${esc(c)}</span>${kw ? `<span class="ckw">${esc(kw)}</span>` : ""}</a>`;
  });
  return `<div class="comps">${buttons.join("")}</div>`;
}

// the due part of the kanji page header: relative wording plus the same colour classes as the Stats page
// and the navbar counter (green = no due date, blue = due today, red = overdue; future dates stay neutral)
function dueLabel(due: string | null): { text: string; cls: string } {
  if (!due) return { text: "Due now", cls: "kdue-fresh" };
  const [y, m, d] = due.split("-").map(Number);
  if (!y || !m || !d) return { text: `Due ${due}`, cls: "" };
  const now = new Date();
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days === 0) return { text: "Due today", cls: "kdue-today" };
  if (days > 0) return { text: `Due in ${days} ${days === 1 ? "day" : "days"}`, cls: "" };
  const ago = -days;
  return { text: `Due ${ago} ${ago === 1 ? "day" : "days"} ago`, cls: "kdue-overdue" };
}

async function kanjiPage(literal: string, url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const k = db.query(`SELECT * FROM kanjis WHERE literal = ?`).get(literal) as Kanji | null;
  const back = q ? `/?q=${enc(q)}` : "/";
  if (!k) return html(layout("Not found", q, `<div><a class="back" href="${back}">Back</a></div><div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);

  const img = await findImage(k.literal);
  const state = k.added === 1 ? (k.unfinished === 1 ? "unfinished" : "added") : "";
  const status = state === "unfinished" ? `<span class="sr">Unfinished</span>` : state === "added" ? `<span class="sr">In your study list</span>` : "";
  const known = totalKnown();
  // the score and the next review, shown as a small line at the top left of the card instead of a badge
  const masteryScore = Math.round(Number(k.score ?? 0) || 0);
  const due = dueLabel(k.due_date ?? null);
  const masteryLine = k.added === 1
    ? `<div class="kmeta"><span>${esc(masteryFor(masteryScore).label)}</span><span class="ksep">/</span><span>Score ${masteryScore}</span><span class="ksep">/</span><span class="${due.cls}">${esc(due.text)}</span></div>`
    : "";
  const item = (label: string, v: string) => `<div><div class="lab">${label}</div><div class="val">${v}</div></div>`;
  const inList = k.added === 1;
  const self = `/kanji/${enc(k.literal)}${q ? `?q=${enc(q)}` : ""}`;
  const detailsOpen = requestContext.getStore()?.detailsOpen ?? true;
  const here = `${self}#details`;
  const editing = url.searchParams.get("edit") === "1";
  const editHref = `/kanji/${enc(k.literal)}?${q ? `q=${enc(q)}&` : ""}edit=1`;
  const field = (name: string, label: string, value: string | null) =>
    `<label class="fl">${label}<input type="text" name="${name}" value="${esc(value)}" autocomplete="off"></label>`;
  const check = (name: string, label: string, on: boolean) =>
    `<label class="check"><input type="checkbox" name="${name}" value="1"${on ? " checked" : ""}>${label}</label>`;
  // the story field: a formatted editor for =keyword= _component_ ?note? #link# (public/js/story-editor.js),
  // which falls back to the plain code textarea when JavaScript is off
  const storyField = `<div class="storyfield">
<span class="flab" id="storylab">Story</span>
<div class="storytools" id="storytools" role="toolbar" aria-label="Story formatting" hidden>
<button type="button" class="tool" data-mark="=" title="Keyword: =text=">= Keyword</button>
<button type="button" class="tool" data-mark="_" title="Component: _text_">_ Component</button>
<button type="button" class="tool" data-mark="?" title="Note: ?text?">? Note</button>
<button type="button" class="tool" data-mark="#" title="Link: #text#"># Link</button>
<span class="sp"></span>
<button type="button" class="tool" id="storymode" aria-pressed="false">Show code</button>
</div>
<div class="storyed" id="storyed" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="storylab" hidden></div>
<textarea name="story" id="storycode" aria-label="Story">${esc(k.story)}</textarea>
</div>`;
  const editForm = `<form class="editf" id="editform" method="post" action="/kanji/${enc(k.literal)}/edit">
<input type="hidden" name="back" value="${esc(self)}">
${field("keyword", "Keyword", k.keyword)}
${field("components", "Components", k.components)}
${field("other_forms", "Other forms", k.other_forms)}
${field("related", "Related", k.related)}
${storyField}
<div class="checks">${check("added", "Added", k.added === 1)}${check("unfinished", "Unfinished", k.unfinished === 1)}${check("is_component", "Is component", k.is_component === 1)}</div>
</form>`;
  const detailsBody = detailsOpen ? `<div class="ds">
${item("Strokes", plain(k.strokes))}${item("Grade", plain(k.grade))}
${item("On readings", readings(k.onReadings))}${item("Kun readings", readings(k.kunReadings))}${item("Frequency", plain(k.frequency))}${item("Heisig 6", plain(k.heisg6))}
${item("Related", linkKanji(k.related, q))}${item("Other forms", linkKanji(k.other_forms, q))}
</div>` : "";
  const lit = esc(k.literal);
  const imgForm = `<input type="hidden" name="back" value="${esc(editHref)}">`;
  const picBlock = `<div class="picwrap">
${img
      ? `<div class="pic"><img src="/img/${enc(k.literal)}" alt="Image for ${lit}" tabindex="0" title="Click to enlarge"></div>`
      : `<div class="pic ph"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>No image yet</div>`}
${editing ? `<div class="picbtns">
<form method="post" action="/kanji/${enc(k.literal)}/image" enctype="multipart/form-data">${imgForm}
<label class="picbtn"><input class="sr" type="file" name="image" accept="image/jpeg,image/png" aria-label="Upload an image for ${lit}" onchange="this.form.requestSubmit()">Upload</label></form>
${img ? `<form method="post" action="/kanji/${enc(k.literal)}/image/delete" data-msg="Remove the image for ${lit}?" onsubmit="return confirm(this.dataset.msg)">${imgForm}
<button class="picbtn" type="submit" aria-label="Remove the image for ${lit}">Remove</button></form>` : ""}
</div>` : ""}</div>`;
  const detailsBlock = `<div class="details${detailsOpen ? " open" : ""}" id="details">
<form class="details-toggle" method="post" action="/details/toggle">
<input type="hidden" name="details" value="${detailsOpen ? "closed" : "open"}">
<input type="hidden" name="back" value="${esc(here)}">
<button type="submit" aria-expanded="${detailsOpen}"><span>Details</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>
</form>
${detailsBody}
</div>`;
  // the actions live in this row at the bottom right; Save submits the edit form through its form attribute (adding or removing a kanji is the "Added" checkbox in that form)
  const actionsRow = `<div class="pagetop">
${status}
<div class="actions">
${editing
      ? `<a class="btn edit" href="${esc(self)}">Cancel</a><button class="btn add" type="submit" form="editform">Save</button>`
      : `<a class="btn edit" href="${esc(editHref)}" aria-label="Edit ${esc(k.literal)}">Edit</a>`}
</div></div>`;
  const body = `
<div class="kanji-card${state ? ` ${state}` : ""}">
${masteryLine}
<div class="detail">
<div class="right">
<div class="top">
<div class="big k">${esc(k.literal)}</div>
${k.keyword ? `<div class="kwbig">${esc(keywordText(k.keyword))}</div>` : ""}<div class="meanbig${k.keyword ? "" : " no-kw"}">${meanings(k.meanings)}${k.jlpt || k.kanken ? `<div class="levels">${jlptBadge(k, known)}${kankenBadge(k, known)}</div>` : ""}</div>
</div>
${componentButtons(k.components, q)}
</div>
${picBlock}
</div>
${k.story ? `<div class="story-paper"><div class="story">${storyHtml(k.story).replace(/\n/g, "<br>")}</div></div>` : ""}
${editing ? `${editForm}
<script src="/js/story-editor.js" defer></script>
${actionsRow}` : `${actionsRow}
${detailsBlock}
${exampleWords(k.literal, self)}
${componentOf(k.literal, q)}`}
</div>`;
  // reached through "Show answer": bad / neutral / good / easy buttons (each saves the result using the score changes from the settings) instead of the plain review link
  const reviewBar = url.searchParams.get("review") === "1"
    ? REVIEW_BUTTONS
      .map(([id, label], i) => `<form method="post" action="/review/${enc(k.literal)}/${id}"><button class="reviewbtn ${id}" type="submit" aria-keyshortcuts="${REVIEW_KEYS[i]}"><kbd class="kbd">${REVIEW_KEYS[i]}</kbd><span class="pad">${REVIEW_PAD[i]}</span>${label}</button></form>`).join("")
    : undefined;
  return html(layout(`${k.literal} – Kanji`, q, body, "", reviewBar));
}

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

// ---------- images ----------
const IMAGE_EXTS = ["jpg", "png"] as const;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const imagePath = (literal: string, ext: string) => join(IMAGES_DIR, `${literal}.${ext}`);
const imageExtsOnDisk = async (literal: string) => {
  const found: string[] = [];
  for (const ext of IMAGE_EXTS) if (await Bun.file(imagePath(literal, ext)).exists()) found.push(ext);
  return found;
};
// delete every image of the kanji except the format being kept, then verify nothing else is left; returns an error message or null
async function removeImages(literal: string, keep?: string): Promise<string | null> {
  for (const ext of IMAGE_EXTS) {
    if (ext === keep) continue;
    try { await unlink(imagePath(literal, ext)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") return `Could not delete ${literal}.${ext}: ${(e as Error).message}`; }
  }
  const left = (await imageExtsOnDisk(literal)).filter((ext) => ext !== keep);
  return left.length ? `Old image files are still present for ${literal}: ${left.map((e) => `${literal}.${e}`).join(", ")}.` : null;
}
const sniffImage = (b: Uint8Array): "png" | "jpg" | null =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a ? "png"
    : b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg" : null;
const imageError = (msg: string, status: number) =>
  html(layout("Error", "", `<div class="box empty">${esc(msg)}</div>`), status);
const kanjiExists = (literal: string) =>
  [...literal].length === 1 && !!db.query(`SELECT 1 FROM kanjis WHERE literal = ?`).get(literal);

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
// the next kanji to review: added kanji that are due (due today or earlier, or never scheduled), the most overdue first,
// then the one reviewed longest ago (never reviewed first), then the lowest score, then random.
// Read-only: nothing is recorded until a result button is pressed.
function pickReviewKanji(): string | null {
  const k = db.query(
    `SELECT literal FROM kanjis
     WHERE COALESCE(added, 0) = 1 AND (due_date IS NULL OR due_date <= date('now', 'localtime'))
     ORDER BY due_date ASC, last_reviewed ASC, COALESCE(score, 0) ASC, RANDOM() LIMIT 1`,
  ).get() as { literal: string } | null;
  return k?.literal ?? null;
}

// /review: only chooses the next kanji and redirects to its own page; nothing is recorded until a result button is pressed there
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

// bad / neutral / good / easy: change the score by the amounts from the settings (default -3 / 0 / +1 / +2) within the bounds,
// schedule the next review from the new score's interval in mastery_levels (a bad answer is due again today),
// and record the review in review_history (score before and after, type as text). Rows are never deleted: it is a permanent log.
const REVIEW_DELTA_KEYS = { bad: "review_delta_bad", neutral: "review_delta_neutral", good: "review_delta_good", easy: "review_delta_easy" } as const;
type ReviewResult = keyof typeof REVIEW_DELTA_KEYS;

async function reviewResult(req: Request, literal: string, result: ReviewResult) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  try {
    const found = db.transaction(() => {
      const k = db.query(`SELECT score FROM kanjis WHERE literal = ?`).get(literal) as { score: number | null } | null;
      if (!k) return false;
      const before = Math.round(Number(k.score ?? 0) || 0);
      const [lo, hi] = scoreBounds();
      const after = Math.min(hi, Math.max(lo, Math.round(before + setting(REVIEW_DELTA_KEYS[result]))));
      const days = result === "bad" ? 0 : masteryFor(after).interval_days;
      db.run(
        `UPDATE kanjis SET score = ?, last_reviewed = date('now', 'localtime'), due_date = date('now', 'localtime', ?) WHERE literal = ?`,
        [after, `+${days} days`, literal],
      );
      db.run(`INSERT INTO review_history (kanji, date, "before", "after", type) VALUES (?, datetime('now', 'localtime'), ?, ?, ?)`, [literal, before, after, result]);
      return true;
    })();
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
const STAT_RANGES = [30, 90, 180] as const;
const BLUES = ["#dbe7f8", "#b5cff2", "#8fb7ec", "#5f9ae0", "#2a78d6", "#1f5fb5", "#184d94", "#0d2c57"]; // one hue, light to dark: the levels are ordered
// the three due states: green = no due date yet (new), blue = due today, red = overdue
const DUE_COLORS = { fresh: "#16A34A", today: "#2a78d6", overdue: "#DC2626" } as const;
const SVG_W = 720;
const SVG_H = 300;
const PAD = { l: 46, r: 14, t: 12, b: 30 };
const r1 = (x: number) => Math.round(x * 10) / 10;

// date arithmetic on plain YYYY-MM-DD strings (no timezone involved)
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// a "nice" step so that four steps cover the largest value
function axisStep(v: number): number {
  for (let p = 1; ; p *= 10) for (const m of [1, 2, 5]) if (4 * m * p >= v) return m * p;
}

function yAxis(ymax: number, step: number): string {
  let out = "";
  for (let v = 0; v <= ymax; v += step) {
    const y = r1(PAD.t + (SVG_H - PAD.t - PAD.b) * (1 - v / ymax));
    out += `<line class="${v === 0 ? "ax" : "gl"}" x1="${PAD.l}" x2="${SVG_W - PAD.r}" y1="${y}" y2="${y}"/><text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end">${v}</text>`;
  }
  return out;
}

// stacked area chart; series are stacked from the first (bottom) to the last
function areaChart(days: string[], series: { label: string; color: string; values: number[] }[], description: string): string {
  const n = days.length;
  const plotW = SVG_W - PAD.l - PAD.r;
  const plotH = SVG_H - PAD.t - PAD.b;
  const totals = days.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const step = axisStep(Math.max(...totals, 1));
  const ymax = step * 4;
  const x = (i: number) => r1(PAD.l + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1)));
  const y = (v: number) => r1(PAD.t + plotH * (1 - v / ymax));
  const cum = days.map(() => 0);
  const areas = series.map((s) => {
    const lower = [...cum];
    s.values.forEach((v, i) => (cum[i] += v));
    const top = cum.map((v, i) => `${x(i)},${y(v)}`);
    const bottom = lower.map((v, i) => `${x(i)},${y(v)}`).reverse();
    return `<path d="M${top.join("L")}L${bottom.join("L")}Z" fill="${s.color}"/>`;
  });
  const slot = plotW / n;
  const hover = days.map((d, i) => `<rect x="${r1(PAD.l + i * slot)}" y="${PAD.t}" width="${r1(slot)}" height="${plotH}" fill="transparent"><title>${esc(d)}: ${series.map((s) => `${esc(s.label)} ${s.values[i]}`).join(", ")}</title></rect>`).join("");
  const count = Math.min(6, n);
  const ticks = Array.from({ length: count }, (_, j) => (count === 1 ? 0 : Math.round((j * (n - 1)) / (count - 1))));
  const xlabels = [...new Set(ticks)].map((i) => `<text x="${x(i)}" y="${SVG_H - 8}" text-anchor="middle">${esc(days[i].slice(5))}</text>`).join("");
  return `<svg class="sv" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="${esc(description)}"><title>${esc(description)}</title>${yAxis(ymax, step)}${areas.join("")}${xlabels}${hover}</svg>`;
}

// stacked vertical bars: every bar is a list of segments drawn from the bottom up, so one column can show
// parts of a whole (the due queue) next to single-colour columns (the days to come)
function barChart(labels: string[], bars: { value: number; color: string }[][], titles: string[], description: string): string {
  const n = labels.length;
  const plotW = SVG_W - PAD.l - PAD.r;
  const plotH = SVG_H - PAD.t - PAD.b;
  const totals = bars.map((bar) => bar.reduce((a, s) => a + s.value, 0));
  const step = axisStep(Math.max(...totals, 1));
  const ymax = step * 4;
  const slot = plotW / n;
  const bw = Math.min(24, slot * 0.7);
  const drawn = bars.map((bar, i) => {
    const bx = r1(PAD.l + i * slot + (slot - bw) / 2);
    const top = bar.map((s) => s.value > 0).lastIndexOf(true); // the segment that gets the rounded top
    let base = 0;
    const segments = bar.map((s, j) => {
      const y0 = r1(PAD.t + plotH * (1 - base / ymax));
      base += s.value;
      const y1 = r1(PAD.t + plotH * (1 - base / ymax));
      return s.value > 0
        ? `<rect x="${bx}" y="${y1}" width="${r1(bw)}" height="${r1(y0 - y1)}"${j === top ? ' rx="3"' : ""} fill="${s.color}"/>`
        : "";
    }).join("");
    // a transparent full-height rect keeps the whole column hoverable, even when the bar is short or empty
    return `<g><title>${esc(titles[i])}</title><rect x="${r1(PAD.l + i * slot)}" y="${PAD.t}" width="${r1(slot)}" height="${plotH}" fill="transparent"/>${segments}</g>`;
  }).join("");
  const xlabels = labels.map((l, i) => `<text x="${r1(PAD.l + i * slot + slot / 2)}" y="${SVG_H - 8}" text-anchor="middle">${esc(l)}</text>`).join("");
  return `<svg class="sv" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="${esc(description)}"><title>${esc(description)}</title>${yAxis(ymax, step)}${drawn}${xlabels}</svg>`;
}

// too hard / about right / too easy, from the share of answers that were not bad at a level
function verdict(total: number, okPct: number): { text: string; cls: string } {
  if (total < 30) return { text: "Not enough data", cls: "none" };
  if (okPct < 80) return { text: "Too hard", cls: "hard" };
  if (okPct > 95) return { text: "Too easy", cls: "easy" };
  return { text: "About right", cls: "ok" };
}

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