import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? "./kanji.db";
const IMAGES_DIR = process.env.IMAGES_DIR ?? "./images";

// Opened read-write: writes are the add/remove toggles, the kanji edit form and image upload/removal (IMAGES_DIR must be writable too).
const db = new Database(DB_PATH, { readwrite: true });

type Kanji = {
  literal: string; meanings: string; onReadings: string | null; kunReadings: string | null;
  strokes: number | null; jlpt: number | null; frequency: number | null; grade: number | null;
  heisg6: number | null; components: string | null; other_forms: string | null;
  kanken: number | null; story: string | null; related: string | null; keyword: string | null;
  added: number | null; unfinished: number | null; is_component: number | null;
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
const CSS = `
*{box-sizing:border-box}
:root{color-scheme:light dark;
--bg:light-dark(#F7F5FC,#121019);--text:light-dark(#1E1B3A,#EDEAF8);--muted:light-dark(#6B6790,#A7A1C2);
--line:light-dark(#E6E1F5,#2E2940);--row-line:light-dark(#EFEBFA,#2A2538);--dash:light-dark(#CFC6EE,#4A4266);
--surface:light-dark(#FFFFFF,#1A1724);--surface-hover:light-dark(#FAF8FE,#221E2F);
--field-bg:light-dark(#F0EDFA,#221E2F);--field-border:light-dark(#E1DAF5,#332D47);--field-focus-bg:light-dark(#FFFFFF,#1A1724);
--accent:light-dark(#7C3AED,#A78BFA);--accent-strong:light-dark(#6D28D9,#C4B5FD);--accent-soft:light-dark(#EDE9FB,#2C2545);--on-accent:light-dark(#FFFFFF,#161221);
--badge-bg:light-dark(#F0EDFA,#2A2440);--badge-text:light-dark(#4B3F8F,#D6CCF7);
--btn-bg:light-dark(#FFFFFF,#221E2F);--btn-hover:light-dark(#F6F2FF,#2C2640);
--add-border:light-dark(#7C3AED,#8B5CF6);--add-text:light-dark(#6D28D9,#C4B5FD);
--rem-border:light-dark(#9AD7AE,#3F7D53);--rem-text:light-dark(#166534,#86EFAC);
--in-bg:light-dark(#E6F7EC,#15291D);--in-hover:light-dark(#F0FBF4,#1B3525);
--added-bg:light-dark(#E6F7EC,#101F16);--added-line:light-dark(#BFE3CC,#2A4F36);--added-row-line:light-dark(#D8EEDF,#23432E);--added-dash:light-dark(#A9D9BA,#3B6E4A);
--unfinished-bg:light-dark(#FEE2E2,#2A1216);--unfinished-line:light-dark(#FCA5A5,#7F1D1D);--unfinished-row-line:light-dark(#FAD1D1,#3A1B1E);--unfinished-dash:light-dark(#F87171,#B91C1C);
--added-bar:light-dark(#16A34A,#4ADE80);--unfinished-bar:light-dark(#DC2626,#F87171);
--focus-ring:light-dark(#7C3AED,#C4B5FD);--mark-line:light-dark(#7C3AED,#C4B5FD);--logo-bg:#7C3AED;--logo-fg:#FFFFFF;
--sug-border:light-dark(#D9D2F2,#3A3352);--clear-bg:light-dark(#E4DEF6,#332D47);--clear-text:light-dark(#4B3F8F,#D6CCF7);
--ink-1:light-dark(var(--bg),#0C0A14);--ink-2:light-dark(var(--bg),#070610);--ink-border:light-dark(var(--line),#443B67);--ink-text:light-dark(var(--text),#F6F0E2);--ink-shadow:light-dark(0 6px 18px rgba(30,27,58,.08),0 0 0 1px rgba(167,139,250,.14),0 14px 30px rgba(0,0,0,.55))}
:root[data-theme="light"]{color-scheme:light}
:root[data-theme="dark"]{color-scheme:dark}
body{margin:0;font-family:Nunito,system-ui,sans-serif;color:var(--text);background:var(--bg);min-height:100vh}
.k{font-family:"Noto Serif JP","Hiragino Mincho ProN","Yu Mincho",serif}
mark{background:none;color:inherit;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:.18em;text-decoration-color:var(--mark-line)}
a{color:inherit;text-decoration:none}
a:focus-visible,input:focus-visible,button:focus-visible{outline:3px solid var(--focus-ring);outline-offset:3px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
header{display:grid;grid-template-columns:1fr minmax(0,620px) 1fr;align-items:center;gap:24px;min-height:72px;padding:12px 32px;background:var(--surface);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;font-weight:900;font-size:20px;justify-self:start}
.logo{width:40px;height:40px;border-radius:12px;background:var(--logo-bg);color:var(--logo-fg);display:flex;align-items:center;justify-content:center;font-size:22px}
form.s{display:flex;align-items:center;gap:10px;height:46px;padding:0 16px;border-radius:14px;background:var(--field-bg);border:2px solid var(--field-border)}
form.s:focus-within{border-color:var(--accent);background:var(--field-focus-bg)}
form.s>svg{flex:none;color:var(--muted)}
form.s input{flex:1;min-width:0;background:none;border:0;color:inherit;caret-color:var(--accent);font:700 16px Nunito,system-ui,sans-serif;outline:0}
.clear{width:26px;height:26px;border-radius:13px;background:var(--clear-bg);color:var(--clear-text);display:flex;align-items:center;justify-content:center;font-size:15px}
.themes{display:flex;justify-self:end}
.theme-f{margin:0;display:flex}
.theme-btn{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px;border-radius:12px;background:var(--surface);border:1px solid var(--line);color:var(--text);font:800 14px Nunito,system-ui,sans-serif;cursor:pointer}
.theme-btn:hover{background:var(--surface-hover);border-color:var(--accent)}
.theme-btn svg{color:var(--accent-strong)}
.themes .to-light{display:none}
[data-theme="dark"] .themes .to-light{display:inline-flex}
[data-theme="dark"] .themes .to-dark{display:none}
@media(prefers-color-scheme:dark){:root:not([data-theme]) .themes .to-light{display:inline-flex}:root:not([data-theme]) .themes .to-dark{display:none}}
main{max-width:1040px;margin:0 auto;padding:28px 32px 48px;display:flex;flex-direction:column;gap:28px}
h2{font-size:18px;font-weight:900;margin:0 0 12px}
.box{background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.pills{display:flex;gap:10px;flex-wrap:wrap}
.pill{font-weight:800;font-size:14px;padding:8px 18px;border-radius:20px;background:var(--surface);border:1px solid var(--line)}
.pill.on{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.sugs{display:flex;flex-direction:column;gap:8px;align-items:center;margin-bottom:-4px}
.sug{display:flex;align-items:center;gap:12px;width:100%;max-width:620px;padding:10px 16px 10px 10px;border-radius:14px;background:var(--surface);border:1px solid var(--sug-border);font-size:15px;font-weight:700;color:var(--muted)}
.sug:hover{border-color:var(--accent)}
.sug .tag{width:32px;height:32px;border-radius:10px;background:var(--accent-soft);color:var(--accent-strong);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700}
.sug .to{font-size:22px;font-weight:700;color:var(--accent-strong);margin-left:auto}
.r{display:grid;grid-template-columns:112px 1fr auto;gap:20px;align-items:center;padding:16px 24px;border-top:1px solid var(--row-line)}
.w{display:flex;flex-direction:column;gap:8px;padding:14px 24px;border-top:1px solid var(--row-line);scroll-margin-top:90px}
.wtop{display:grid;grid-template-columns:1fr auto auto;gap:16px;align-items:center;min-width:0}
.wtop .badges{justify-self:end}
.wm{font-size:17px;font-weight:700;line-height:1.45;display:flex;flex-direction:column;gap:1px;min-width:0}
.sense{display:block;position:relative;min-width:0;padding-left:18px;overflow-wrap:anywhere}
.sense::before{content:"•";position:absolute;left:2px;top:.35em;color:var(--muted);font-size:12px;font-weight:900}
.box>:first-child{border-top:0}
.rklink{justify-self:center;display:flex;align-items:center;color:inherit;border-radius:14px}
.rklink:hover .rk{color:var(--accent-strong);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:6px}
.in,.in:hover{background:var(--in-bg)}
.r.unfinished,.r.unfinished:hover{background:var(--unfinished-bg)}
.rk{font-size:58px;font-weight:700;line-height:1;justify-self:center}
.rm{display:flex;flex-direction:column;gap:4px;min-width:0}
.mean{font-size:18px;font-weight:800}
.kw{font-size:13px;font-weight:900;color:var(--accent-strong);text-transform:uppercase}
.readings{display:flex;flex-wrap:wrap;gap:2px 14px;font-size:13px;font-weight:700;line-height:1.35;color:var(--muted)}
.readings>span{min-width:0;overflow-wrap:anywhere}
.rlab{font-size:10px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;opacity:.75;margin-right:4px}
.wk{font-size:28px;font-weight:700;min-width:0}.alt{display:block;font-size:13px;font-weight:700;color:var(--muted);font-family:Nunito,system-ui,sans-serif}
.wordlink:hover{color:var(--accent-strong);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:4px}
.wordlink:hover mark{text-decoration:none}
.kmarker{font-size:14px;font-weight:800;color:var(--muted);font-family:Nunito,system-ui,sans-serif;margin-left:2px}
.kana{font-size:19px;font-weight:700;color:var(--muted);margin-left:6px}
.badges{display:flex;gap:6px;flex-wrap:wrap}
.b{font-size:12px;font-weight:800;padding:4px 10px;border-radius:10px;background:var(--badge-bg);color:var(--badge-text)}
.btn{width:92px;height:36px;border-radius:10px;background:var(--btn-bg);color:var(--text);font:800 13px Nunito,system-ui,sans-serif;cursor:pointer}
.btn:hover{background:var(--btn-hover)}.in .btn:hover{background:var(--in-hover)}
.add{border:2px solid var(--add-border);color:var(--add-text)}.rem{border:2px solid var(--rem-border);color:var(--rem-text)}
.edit{border:2px solid var(--field-border);display:inline-flex;align-items:center;justify-content:center}
.actions{display:flex;align-items:center;gap:10px}.actions form{margin:0}
.editf{min-width:0;display:flex;flex-direction:column;gap:18px;margin-top:28px}
.editf label.fl{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:800;color:var(--muted)}
.editf input[type=text],.editf textarea{width:100%;padding:10px 14px;border-radius:12px;background:var(--field-bg);border:2px solid var(--field-border);color:var(--text);font:700 16px Nunito,system-ui,sans-serif}
.editf textarea{min-height:180px;resize:vertical;line-height:1.6}
.editf input[type=text]:focus,.editf textarea:focus{border-color:var(--accent);background:var(--field-focus-bg);outline:0}
.checks{display:flex;gap:28px;flex-wrap:wrap}
.check{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;cursor:pointer}
.check input{width:20px;height:20px;accent-color:var(--accent)}
.formbtns{display:flex;gap:10px}
.empty{padding:48px 24px;text-align:center;color:var(--muted);font-weight:700}
.back{display:inline-flex;align-items:center;gap:6px;font-weight:900;font-size:15px;color:var(--accent-strong);height:40px}
.pagetop{display:flex;align-items:center;justify-content:space-between;gap:16px}
.kanji-card{margin-top:12px;padding:28px;border:1px solid var(--line);border-radius:24px;background:var(--surface)}
.kanji-card.added{border-left:5px solid var(--added-bar)}
.kanji-card.unfinished{border-left:5px solid var(--unfinished-bar)}
.detail{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:28px 56px;align-items:start}
.top{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto auto;column-gap:36px;align-items:center}
.big{grid-row:1/3;grid-column:1;font-size:170px;font-weight:500;line-height:1;text-align:center}
.kwbig{grid-column:2;grid-row:1;align-self:end}
.meanbig{grid-column:2;grid-row:2;align-self:start}
.meanbig.no-kw{grid-row:1/3;align-self:center}
.picwrap{position:relative;width:300px;max-width:100%}
.pic{width:100%;aspect-ratio:1;border-radius:20px;overflow:hidden}
.picbtns{position:absolute;right:10px;bottom:10px;display:flex;gap:8px}
.picbtns form{margin:0}
.picbtn{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:10px;background:var(--surface);border:1px solid var(--line);color:var(--text);font:800 12px Nunito,system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18)}
.picbtn:hover{background:var(--btn-hover);border-color:var(--accent)}
.picbtn:focus-within{outline:3px solid var(--focus-ring);outline-offset:2px}
.pic img{width:100%;height:100%;object-fit:cover;display:block}
.ph{border:2px dashed var(--dash);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--muted);font-size:13px;font-weight:700;text-align:center;padding:16px}
.right{min-width:0;display:flex;flex-direction:column;gap:28px}
.kwbig{font-size:44px;font-weight:900;line-height:1.05;overflow-wrap:anywhere;color:var(--accent-strong);text-transform:uppercase}
.meanbig{font-size:22px;font-weight:700;margin-top:10px;color:var(--text)}
.meanbig.no-kw{margin:0;font-size:40px}
.lab{font-size:12px;font-weight:800;color:var(--muted);margin-bottom:2px}
.comps{display:flex;flex-wrap:wrap;gap:10px}
.comp{display:inline-flex;align-items:center;gap:10px;padding:8px 16px;border-radius:12px;background:var(--btn-bg);border:2px solid var(--field-border)}
.comp:hover{background:var(--btn-hover);border-color:var(--accent)}
.comp.added,.comp.added:hover{border-color:var(--added-bar)}
.comp.unfinished,.comp.unfinished:hover{border-color:var(--unfinished-bar)}
.comp .k{font-size:28px;font-weight:700;line-height:1}
.comp .ckw{font-size:13px;font-weight:900;color:var(--accent-strong);text-transform:uppercase}
.examples{border-top:1px solid var(--line);padding-top:16px;margin-top:28px}
.ex-head{font:900 15px Nunito,system-ui,sans-serif;margin-bottom:12px}
.exs{display:flex;flex-wrap:wrap;gap:10px}
.exw{position:relative}
.ex{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:12px;background:var(--btn-bg);border:2px solid var(--field-border)}
.ex:hover{background:var(--btn-hover);border-color:var(--accent)}
.ex.added{border-color:var(--rem-border)}.ex.added:hover{border-color:var(--rem-text)}
.ex .k{font-size:22px;font-weight:700}
.tip{display:none;pointer-events:none;position:absolute;z-index:20;top:calc(100% + 8px);left:0;width:max-content;min-width:240px;max-width:min(380px,80vw);padding:14px 16px;border-radius:14px;background:var(--surface);border:1px solid var(--ink-border);box-shadow:var(--ink-shadow);color:var(--text)}
.exw:hover .tip,.exw:focus-within .tip{display:block}
.tip .wk{display:block;font-size:24px;margin-bottom:6px}
.tip .wm{font-size:15px}
.exmore{margin-top:12px}.exmore .exs{margin-top:12px}
.exmore summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;height:36px;padding:0 16px;border-radius:10px;border:2px solid var(--field-border);background:var(--btn-bg);font:800 13px Nunito,system-ui,sans-serif}
.exmore summary::-webkit-details-marker{display:none}
.exmore summary:hover{background:var(--btn-hover)}
.s-open{display:none}.exmore[open] .s-closed{display:none}.exmore[open] .s-open{display:inline}
.story{font-size:19px;line-height:1.7}
.story-paper{position:relative;overflow:hidden;margin-top:28px;padding:24px 26px;border-radius:14px;border:1px solid var(--accent);color:var(--ink-text);background:linear-gradient(180deg,var(--ink-1),var(--ink-2));box-shadow:var(--ink-shadow)}
.story-paper .story{max-width:none;line-height:1.7}
.story_keyword{color:var(--accent-strong);font-weight:800}
.story_component{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:.2em}
.story_note{background:light-dark(#FEF08A,#4D4210);border-radius:4px;padding:0 .25em}
.story_link{color:var(--accent-strong);text-decoration:underline dotted;text-decoration-thickness:2px;text-underline-offset:.2em}
.story_link:hover{text-decoration-style:solid}
.details{border-top:1px solid var(--line);margin-top:28px}
.details-toggle{margin:0}
.details-toggle button{width:100%;display:flex;align-items:center;justify-content:space-between;height:52px;padding:0;border:0;background:none;color:inherit;font:900 15px Nunito,system-ui,sans-serif;cursor:pointer}
.details-toggle svg{color:var(--muted);transform:rotate(180deg)}
.details.open .details-toggle svg{transform:none}
.ds{display:grid;grid-template-columns:repeat(4,1fr);gap:20px 24px;padding-bottom:20px}
.val{font-size:19px;font-weight:800;overflow-wrap:anywhere}
.kl{font-size:22px;margin-right:6px}a.kl{color:var(--accent-strong)}
@media(max-width:900px){.kanji-card{padding:20px}.detail{grid-template-columns:minmax(0,1fr);gap:24px}.picwrap{margin:0 auto}.ds{grid-template-columns:1fr 1fr}.wtop{grid-template-columns:1fr auto;gap:4px 16px}.wtop .wk{grid-column:1;grid-row:1}.wtop form{grid-column:2;grid-row:1;justify-self:end}.wtop .badges{grid-column:2;grid-row:2;justify-self:end}}
@media(max-width:560px){header{grid-template-columns:auto 1fr auto;padding:12px 16px;gap:12px}.brand span:last-child{display:none}.theme-btn{width:40px;padding:0;justify-content:center}.theme-btn span{display:none}main{padding:20px 16px 40px}.kanji-card{padding:16px;border-radius:18px}.kwbig{font-size:32px}.big{font-size:110px}.top{column-gap:20px}.r{grid-template-columns:76px 1fr;padding:12px 16px}.rk{font-size:48px}.r .badges{grid-column:2}.readings{font-size:12px;gap:2px 10px}}
`;

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

const layout = (title: string, q: string, body: string) => {
  const ctx = requestContext.getStore();
  const theme = ctx?.theme;
  const back = ctx?.back ?? "/";
  return `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;700&family=Nunito:wght@500;700;800;900&display=swap">
<style>${CSS}</style></head><body>
<header>
<a class="brand" href="/"><span class="logo k">漢</span><span>Kanji</span></a>
<form class="s" action="/" method="get" role="search">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
<input name="q" value="${esc(q)}" placeholder="Kanji, keyword, meaning or reading" aria-label="Search" autocomplete="off" required ${shortQuery(q) ? "autofocus" : ""}>
${q ? `<a class="clear" href="/" aria-label="Clear search">×</a>` : ""}
</form>${themeToggle(back)}</header>
<main>${body}</main></body></html>`;
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

const kanjiRow = (k: Kanji, q: string) => {
  const unfinished = k.unfinished === 1;
  return `
<div class="r${unfinished ? " unfinished" : k.added === 1 ? " in" : ""}">
<a class="rklink" href="/kanji/${enc(k.literal)}?q=${enc(q)}" aria-label="Open ${esc(k.literal)}"><span class="rk k">${esc(k.literal)}</span></a>
<span class="rm">${k.keyword ? `<span class="kw">${highlight(keywordText(k.keyword), q)}</span>` : ""}<span class="mean">${highlight(meaningsText(k.meanings), q)}</span>${readingsRow(k, q)}</span>
<span class="badges">${unfinished ? `<span class="sr">Unfinished</span>` : k.added === 1 ? `<span class="sr">In your study list</span>` : ""}${k.jlpt ? `<span class="b">N${esc(k.jlpt)}</span>` : ""}${k.kanken ? `<span class="b">Kanken ${esc(k.kanken)}</span>` : ""}</span></div>`;
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
    body += `<section><h2>Kanji</h2><div class="box">${kanji.map((k) => kanjiRow(k, q)).join("")}</div></section>`;
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
function exampleWords(literal: string) {
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
    const tip = `<span class="tip"><span class="k wk">${esc(label)}${w.kanji && w.kana ? `<span class="kana">「${esc(w.kana)}」</span>` : ""}${w.kanji_alternative ? `<span class="alt">also ${esc(w.kanji_alternative)}</span>` : ""}</span><span class="wm">${meaningGroups(w.meanings).map((m) => `<span class="sense">${esc(m)}</span>`).join("")}</span></span>`;
    return `<span class="exw"><a class="ex${added ? " added" : ""}" href="/?q=${enc(target)}" aria-label="Search for ${esc(target)}${added ? " (in your study list)" : ""}">${face}</a>${tip}</span>`;
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
    const state = r.unfinished === 1 ? "unfinished" : r.added === 1 ? "added" : "";
    const kw = keywordText(r.keyword);
    const status = state === "unfinished" ? " (unfinished)" : state === "added" ? " (in your study list)" : "";
    return `<a class="comp${state ? ` ${state}` : ""}" href="/kanji/${enc(r.literal)}${q ? `?q=${enc(q)}` : ""}" aria-label="Open ${esc(r.literal)}${kw ? ` (${esc(kw)})` : ""}${status}"><span class="k">${esc(r.literal)}</span>${kw ? `<span class="ckw">${esc(kw)}</span>` : ""}</a>`;
  });
  return `<div class="examples">
<div class="ex-head">Component for:</div>
<div class="exs">${buttons.join("")}</div>
</div>`;
}

// one button per component character, linking to a search for it; shows its keyword when it is a kanji in the database
function componentButtons(s: string | null) {
  const chars = [...new Set([...(s ?? "")].filter((c) => !/[\s,、;；，]/.test(c)))];
  if (!chars.length) return "";
  const keywords = new Map(
    (db.query(`SELECT literal, keyword FROM kanjis WHERE literal IN (${chars.map(() => "?").join(",")})`).all(...chars) as { literal: string; keyword: string | null }[])
      .map((r) => [r.literal, keywordText(r.keyword)]),
  );
  const buttons = chars.map((c) => {
    const kw = keywords.get(c);
    return `<a class="comp" href="/?q=${enc(c)}" aria-label="Search for ${esc(c)}${kw ? ` (${esc(kw)})` : ""}"><span class="k">${esc(c)}</span>${kw ? `<span class="ckw">${esc(kw)}</span>` : ""}</a>`;
  });
  return `<div class="comps">${buttons.join("")}</div>`;
}

async function kanjiPage(literal: string, url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const k = db.query(`SELECT * FROM kanjis WHERE literal = ?`).get(literal) as Kanji | null;
  const back = q ? `/?q=${enc(q)}` : "/";
  if (!k) return html(layout("Not found", q, `<div><a class="back" href="${back}">Back</a></div><div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);

  const img = await findImage(k.literal);
  const state = k.unfinished === 1 ? "unfinished" : k.added === 1 ? "added" : "";
  const status = state === "unfinished" ? `<span class="sr">Unfinished</span>` : state === "added" ? `<span class="sr">In your study list</span>` : "";
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
  const editForm = `<form class="editf" method="post" action="/kanji/${enc(k.literal)}/edit">
<input type="hidden" name="back" value="${esc(self)}">
${field("keyword", "Keyword", k.keyword)}
${field("components", "Components", k.components)}
${field("other_forms", "Other forms", k.other_forms)}
${field("related", "Related", k.related)}
<label class="fl">Story<textarea name="story">${esc(k.story)}</textarea></label>
<div class="checks">${check("unfinished", "Unfinished", k.unfinished === 1)}${check("is_component", "Is component", k.is_component === 1)}</div>
<div class="formbtns"><button class="btn add" type="submit">Save</button><a class="btn edit" href="${esc(self)}">Cancel</a></div>
</form>`;
  const detailsBody = detailsOpen ? `<div class="ds">
${item("Strokes", plain(k.strokes))}${item("JLPT", k.jlpt ? "N" + esc(k.jlpt) : "–")}${item("Kanken", plain(k.kanken))}${item("Grade", plain(k.grade))}
${item("On readings", readings(k.onReadings))}${item("Kun readings", readings(k.kunReadings))}${item("Frequency", plain(k.frequency))}${item("Heisig 6", plain(k.heisg6))}
${item("Related", linkKanji(k.related, q))}${item("Other forms", linkKanji(k.other_forms, q))}
</div>` : "";
  const lit = esc(k.literal);
  const imgForm = `<input type="hidden" name="back" value="${esc(editHref)}">`;
  const picBlock = `<div class="picwrap">
${img
      ? `<div class="pic"><img src="/img/${enc(k.literal)}" alt="Image for ${lit}"></div>`
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
  const body = `
<div class="pagetop"><a class="back" href="${back}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>${q ? "Back to results" : "Search"}</a>
${status}
<div class="actions">
${editing
      ? `<a class="btn edit" href="${esc(self)}">Cancel</a>`
      : `<a class="btn edit" href="${esc(editHref)}" aria-label="Edit ${esc(k.literal)}">Edit</a>`}
<form method="post" action="/kanji/${enc(k.literal)}/toggle"><input type="hidden" name="back" value="${esc(self)}">
<button class="btn ${inList ? "rem" : "add"}" type="submit" aria-label="${inList ? `Remove ${esc(k.literal)} from your study list` : `Add ${esc(k.literal)} to your study list`}">${inList ? "Remove" : "Add"}</button></form></div></div>
<div class="kanji-card${state ? ` ${state}` : ""}">
<div class="detail">
<div class="right">
<div class="top">
<div class="big k">${esc(k.literal)}</div>
${k.keyword ? `<div class="kwbig">${esc(keywordText(k.keyword))}</div>` : ""}<div class="meanbig${k.keyword ? "" : " no-kw"}">${meanings(k.meanings)}</div>
</div>
${componentButtons(k.components)}
</div>
${picBlock}
</div>
${editing ? editForm : `${k.story ? `<div class="story-paper"><div class="story">${storyHtml(k.story).replace(/\n/g, "<br>")}</div></div>` : ""}
${detailsBlock}
${exampleWords(k.literal)}
${componentOf(k.literal, q)}`}
</div>`;
  return html(layout(`${k.literal} – Kanji`, q, body));
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
           unfinished = CASE WHEN COALESCE(added, 0) = 1 THEN 0 ELSE 1 END
       WHERE literal = ?`,
      [literal],
    );
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not update the kanji: ${esc((e as Error).message)}. Is the database file writable?</div>`), 500);
  }
  return new Response(null, { status: 303, headers: { location: back } });
}

// save the edit form: text fields (empty -> NULL) and the two checkboxes (checked -> 1, unchecked -> 0)
async function updateKanji(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const text = (name: string) => String(form.get(name) ?? "").replace(/\r\n?/g, "\n").trim() || null;
  const flag = (name: string) => (form.get(name) ? 1 : 0);
  try {
    const result = db.run(
      `UPDATE kanjis
       SET keyword = ?, components = ?, other_forms = ?, related = ?, story = ?, unfinished = ?, is_component = ?
       WHERE literal = ?`,
      [text("keyword"), text("components"), text("other_forms"), text("related"), text("story"), flag("unfinished"), flag("is_component"), literal],
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

// ---------- server ----------
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    return requestContext.run({ theme: themeFrom(req), detailsOpen: detailsOpenFrom(req), back: url.pathname + url.search }, async () => {
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { return html(layout("Bad request", "", `<div class="box empty">Bad request.</div>`), 400); }

      if (path === "/details/toggle") return req.method === "POST" ? toggleDetails(req) : new Response("Method not allowed", { status: 405 });
      if (path === "/theme") return req.method === "POST" ? setTheme(req) : new Response("Method not allowed", { status: 405 });
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