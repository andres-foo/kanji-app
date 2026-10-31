import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? "./kanji.db";
const IMAGES_DIR = process.env.IMAGES_DIR ?? "./images";
const KANJI_LIMIT = 60;
const WORD_LIMIT = 100;

// Opened read-write: the only write is the add/remove toggle on `examples.added`.
const db = new Database(DB_PATH, { readwrite: true });

type Kanji = {
  literal: string; meanings: string; onReadings: string | null; kunReadings: string | null;
  strokes: number | null; jlpt: number | null; frequency: number | null; grade: number | null;
  heisg6: number | null; components: string | null; other_forms: string | null;
  kanken: number | null; story: string | null; related: string | null; keyword: string | null;
  added: number | null;
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
const meanings = (s: unknown) => esc(String(s ?? "").split(";").map((m) => m.trim()).filter(Boolean).join(", "));
const nullsLast = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);
const enc = encodeURIComponent;

// ---------- theme ----------
type Theme = "light" | "dark";
type RequestContext = { theme: Theme | null; back: string };
// Request-scoped so concurrent requests don't share the cookie's theme.
const requestContext = new AsyncLocalStorage<RequestContext>();
const themeFrom = (req: Request): Theme | null =>
  (/(?:^|;\s*)kanji_theme=(light|dark)(?:;|$)/.exec(req.headers.get("cookie") ?? "")?.[1] as Theme | undefined) ?? null;
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

  // kanji: literal, meanings, on/kun readings (ignoring "." and "-" okurigana marks)
  const kc: string[] = [`CAST(meanings AS TEXT) LIKE ? ESCAPE '\\'`];
  const kp: string[] = [pat(q)];
  if (lits.length) { kc.push(`literal IN (${lits.map(() => "?").join(",")})`); kp.push(...lits); }
  if (hasKana) {
    for (const v of kana) {
      kc.push(`REPLACE(REPLACE(COALESCE(onReadings,'') || ' ' || COALESCE(kunReadings,''), '.', ''), '-', '') LIKE ? ESCAPE '\\'`);
      kp.push(pat(v));
    }
  }
  const kanji = (db.query(`SELECT * FROM kanjis WHERE ${kc.join(" OR ")} LIMIT 300`).all(...kp) as Kanji[])
    .sort((a, b) =>
      Number(lits.includes(b.literal)) - Number(lits.includes(a.literal)) ||
      (b.jlpt ?? 0) - (a.jlpt ?? 0) ||
      nullsLast(a.frequency, b.frequency))
    .slice(0, KANJI_LIMIT);

  // words: kanji, kana, meanings (+ alternative spellings)
  const wc = [`kanji LIKE ? ESCAPE '\\'`, `CAST(meanings AS TEXT) LIKE ? ESCAPE '\\'`, `kanji_alternative LIKE ? ESCAPE '\\'`];
  const wp = [pat(q), pat(q), pat(q)];
  for (const v of kana) { wc.push(`kana LIKE ? ESCAPE '\\'`); wp.push(pat(v)); }
  const exact = (w: Word) => w.kanji === q || (w.kana !== null && kana.includes(w.kana));
  const words = (db.query(`SELECT * FROM examples WHERE ${wc.join(" OR ")} LIMIT 500`).all(...wp) as Word[])
    .sort((a, b) => Number(exact(b)) - Number(exact(a)) || nullsLast(a.freq_wiki, b.freq_wiki))
    .slice(0, WORD_LIMIT);

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
--focus-ring:light-dark(#7C3AED,#C4B5FD);--logo-bg:#7C3AED;--logo-fg:#FFFFFF;
--sug-border:light-dark(#D9D2F2,#3A3352);--clear-bg:light-dark(#E4DEF6,#332D47);--clear-text:light-dark(#4B3F8F,#D6CCF7)}
:root[data-theme="light"]{color-scheme:light}
:root[data-theme="dark"]{color-scheme:dark}
body{margin:0;font-family:Nunito,system-ui,sans-serif;color:var(--text);background:var(--bg);min-height:100vh}
body.added{background:var(--added-bg);--line:var(--added-line);--row-line:var(--added-row-line);--dash:var(--added-dash)}
.k{font-family:"Noto Serif JP","Hiragino Mincho ProN","Yu Mincho",serif}
a{color:inherit;text-decoration:none}
a:focus-visible,summary:focus-visible,input:focus-visible,button:focus-visible{outline:3px solid var(--focus-ring);outline-offset:3px}
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
.r{display:grid;grid-template-columns:96px 1fr auto;gap:16px;align-items:center;padding:14px 24px;border-top:1px solid var(--row-line)}
.w{display:grid;grid-template-columns:180px 160px 1fr auto 92px;gap:16px;align-items:center;padding:14px 24px;border-top:1px solid var(--row-line);scroll-margin-top:90px}
.box>:first-child{border-top:0}
.r:hover{background:var(--surface-hover)}
.in,.in:hover{background:var(--in-bg)}
.rk{font-size:46px;font-weight:700;line-height:1}
.rm{display:flex;flex-direction:column;gap:3px;min-width:0}
.mean{font-size:18px;font-weight:800}
.kw{font-size:13px;font-weight:900;color:var(--accent-strong)}
.wk{font-size:28px;font-weight:700}.alt{display:block;font-size:13px;font-weight:700;color:var(--muted);font-family:Nunito,system-ui,sans-serif}
.kana{font-size:15px;font-weight:700;color:var(--muted)}.wm{font-size:17px;font-weight:700}
.badges{display:flex;gap:6px;flex-wrap:wrap}
.b{font-size:12px;font-weight:800;padding:4px 10px;border-radius:10px;background:var(--badge-bg);color:var(--badge-text)}
.btn{width:92px;height:36px;border-radius:10px;background:var(--btn-bg);color:var(--text);font:800 13px Nunito,system-ui,sans-serif;cursor:pointer}
.btn:hover{background:var(--btn-hover)}.in .btn:hover{background:var(--in-hover)}
.add{border:2px solid var(--add-border);color:var(--add-text)}.rem{border:2px solid var(--rem-border);color:var(--rem-text)}
.empty{padding:48px 24px;text-align:center;color:var(--muted);font-weight:700}
.back{display:inline-flex;align-items:center;gap:6px;font-weight:900;font-size:15px;color:var(--accent-strong);height:40px}
.detail{display:flex;gap:56px;align-items:flex-start;margin-top:12px}
.left{display:flex;flex-direction:column;gap:20px;flex:none;width:300px}
.big{font-size:230px;font-weight:500;line-height:1;text-align:center}
.pic{width:300px;aspect-ratio:1;border-radius:20px;overflow:hidden}
.pic img{width:100%;height:100%;object-fit:cover;display:block}
.ph{border:2px dashed var(--dash);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--muted);font-size:13px;font-weight:700;text-align:center;padding:16px}
.right{flex:1;min-width:0;display:flex;flex-direction:column;gap:28px;padding-top:12px}
.kwbig{font-size:64px;font-weight:900;line-height:1.05;overflow-wrap:anywhere}
.meanbig{font-size:22px;font-weight:700;margin-top:10px;color:var(--accent-strong)}
.meanbig.no-kw{margin:0;font-size:40px;color:var(--text)}
.lab{font-size:12px;font-weight:800;color:var(--muted);margin-bottom:2px}
.story{font-size:19px;line-height:1.7;max-width:60ch}
details{border-top:1px solid var(--line)}
summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;height:52px;font-weight:900;font-size:15px}
summary::-webkit-details-marker{display:none}
summary svg{color:var(--muted)}
details:not([open]) summary svg{transform:rotate(180deg)}
.ds{display:grid;grid-template-columns:repeat(4,1fr);gap:20px 24px;padding-bottom:20px}
.val{font-size:19px;font-weight:800;overflow-wrap:anywhere}
.kl{font-size:22px;margin-right:6px}a.kl{color:var(--accent-strong)}
@media(max-width:900px){.detail{flex-direction:column;gap:24px}.left{width:100%;align-items:center}.ds{grid-template-columns:1fr 1fr}.w{grid-template-columns:1fr auto;gap:6px 16px}.w .wm,.w .kana,.w .badges{grid-column:1}.w form{grid-column:2;grid-row:1}}
@media(max-width:560px){header{grid-template-columns:auto 1fr auto;padding:12px 16px;gap:12px}.brand span:last-child{display:none}.theme-btn{width:40px;padding:0;justify-content:center}.theme-btn span{display:none}main{padding:20px 16px 40px}.kwbig{font-size:44px}.r{grid-template-columns:64px 1fr;padding:12px 16px}.r .badges{grid-column:2}}
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

const layout = (title: string, q: string, body: string, added = false) => {
  const ctx = requestContext.getStore();
  const theme = ctx?.theme;
  const back = ctx?.back ?? "/";
  return `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;700&family=Nunito:wght@500;700;800;900&display=swap">
<style>${CSS}</style></head><body${added ? ' class="added"' : ""}>
<header>
<a class="brand" href="/"><span class="logo k">漢</span><span>Kanji</span></a>
<form class="s" action="/" method="get" role="search">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
<input name="q" value="${esc(q)}" placeholder="Kanji, English meaning or reading" aria-label="Search" autocomplete="off" ${q ? "" : "autofocus"}>
${q ? `<a class="clear" href="/" aria-label="Clear search">×</a>` : ""}
</form>${themeToggle(back)}</header>
<main>${body}</main></body></html>`;
};

const html = (s: string, status = 200) =>
  new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const kanjiRow = (k: Kanji, q: string) => `
<a class="r${k.added === 1 ? " in" : ""}" href="/kanji/${enc(k.literal)}?q=${enc(q)}" aria-label="Open ${esc(k.literal)}">
<span class="rk k">${esc(k.literal)}</span>
<span class="rm"><span class="mean">${meanings(k.meanings)}</span>${k.keyword ? `<span class="kw">${esc(k.keyword)}</span>` : ""}</span>
<span class="badges">${k.added === 1 ? `<span class="sr">In your study list</span>` : ""}${k.jlpt ? `<span class="b">N${esc(k.jlpt)}</span>` : ""}${k.kanken ? `<span class="b">Kanken ${esc(k.kanken)}</span>` : ""}</span></a>`;

const wordRow = (w: Word, back: string) => {
  const inList = w.added === 1;
  return `
<div class="w${inList ? " in" : ""}" id="w${w.id}">
<span class="k wk">${esc(w.kanji || w.kana)}${w.kanji_alternative ? `<span class="alt">also ${esc(w.kanji_alternative)}</span>` : ""}</span>
<span class="kana">${w.kanji ? esc(w.kana) : ""}</span>
<span class="wm">${meanings(w.meanings)}</span>
<span class="badges">${inList ? `<span class="sr">In your study list</span>` : ""}${w.jlpt ? `<span class="b">N${esc(w.jlpt)}</span>` : ""}${w.freq_wiki ? `<span class="b">#${esc(w.freq_wiki)}</span>` : ""}</span>
<form method="post" action="/words/${w.id}/toggle"><input type="hidden" name="back" value="${esc(back)}">
<button class="btn ${inList ? "rem" : "add"}" type="submit">${inList ? "Remove" : "Add"}</button></form>
</div>`;
};

function suggestions(q: string, type: string) {
  const hira = romajiToHiragana(q);
  if (!hira) return "";
  const link = (label: string, tag: string, text: string) =>
    `<a class="sug" href="/?q=${enc(text)}&type=${type}"><span class="tag k">${tag}</span><span>${label}</span><span class="to k">${esc(text)}</span></a>`;
  return `<div class="sugs">${link("Search in hiragana", "あ", hira)}${link("Search in katakana", "ア", toKata(hira))}</div>`;
}

function home(url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const t = url.searchParams.get("type");
  const type = t === "kanji" || t === "words" ? t : "all";
  if (!q) return html(layout("Kanji", "", `<div class="box empty">Search by kanji, English meaning, reading, or romaji.</div>`));

  const { kanji, words } = search(q);
  const back = `/?q=${enc(q)}&type=${type}`;
  const pill = (id: string, label: string) =>
    `<a class="pill${type === id ? " on" : ""}" href="/?q=${enc(q)}&type=${id}">${label}</a>`;
  let body = suggestions(q, type);
  body += `<div class="pills">${pill("all", `All ${kanji.length + words.length}`)}${pill("kanji", `Kanji ${kanji.length}`)}${pill("words", `Words ${words.length}`)}</div>`;
  if (type !== "words" && kanji.length)
    body += `<section><h2>Kanji</h2><div class="box">${kanji.map((k) => kanjiRow(k, q)).join("")}</div></section>`;
  if (type !== "kanji" && words.length)
    body += `<section><h2>Words</h2><div class="box">${words.map((w) => wordRow(w, back)).join("")}</div></section>`;
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
const readings = (s: string | null) => (s ? esc(s.split(/[、,;\s]+/).filter(Boolean).join("、")) : "–");

async function kanjiPage(literal: string, url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const k = db.query(`SELECT * FROM kanjis WHERE literal = ?`).get(literal) as Kanji | null;
  const back = q ? `/?q=${enc(q)}` : "/";
  if (!k) return html(layout("Not found", q, `<div><a class="back" href="${back}">Back</a></div><div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);

  const img = await findImage(k.literal);
  const item = (label: string, v: string) => `<div><div class="lab">${label}</div><div class="val">${v}</div></div>`;
  const body = `
<div><a class="back" href="${back}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>${q ? "Back to results" : "Search"}</a>
${k.added === 1 ? `<span class="sr">In your study list</span>` : ""}
<div class="detail">
<div class="left">
<div class="big k">${esc(k.literal)}</div>
${img
      ? `<div class="pic"><img src="/img/${enc(k.literal)}" alt="Image for ${esc(k.literal)}"></div>`
      : `<div class="pic ph"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/></svg>No image yet: add ${esc(k.literal)}.jpg or ${esc(k.literal)}.png</div>`}
</div>
<div class="right">
<div>${k.keyword ? `<div class="kwbig">${esc(k.keyword)}</div>` : ""}<div class="meanbig${k.keyword ? "" : " no-kw"}">${meanings(k.meanings)}</div></div>
${k.story ? `<div><div class="lab">Story</div><div class="story">${esc(k.story).replace(/\n/g, "<br>")}</div></div>` : ""}
<details open><summary>Details<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></summary>
<div class="ds">
${item("Strokes", plain(k.strokes))}${item("JLPT", k.jlpt ? "N" + esc(k.jlpt) : "–")}${item("Kanken", plain(k.kanken))}${item("Grade", plain(k.grade))}
${item("On readings", readings(k.onReadings))}${item("Kun readings", readings(k.kunReadings))}${item("Frequency", plain(k.frequency))}${item("Heisig 6", plain(k.heisg6))}
${item("Components", linkKanji(k.components, q))}${item("Related", linkKanji(k.related, q))}${k.other_forms ? item("Other forms", linkKanji(k.other_forms, q)) : ""}
</div></details>
</div></div></div>`;
  return html(layout(`${k.literal} – Kanji`, q, body, k.added === 1));
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

// ---------- server ----------
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    return requestContext.run({ theme: themeFrom(req), back: url.pathname + url.search }, async () => {
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { return html(layout("Bad request", "", `<div class="box empty">Bad request.</div>`), 400); }

      if (path === "/theme") return req.method === "POST" ? setTheme(req) : new Response("Method not allowed", { status: 405 });
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
