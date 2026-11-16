// Text and HTML helpers shared by the views.
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
export const likeEsc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
export const toKata = (s: string) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
export const toHira = (s: string) => s.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export const nullsLast = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);
export const enc = encodeURIComponent;

// Imported furigana is encoded inline as 単語《よみ》. The annotated word may
// include okurigana (心して《こころして》), so the surface is matched as one run
// and the shared trailing kana is split off before building the ruby. Only a
// string that parses cleanly becomes markup: any stray bracket or a string with
// no pairs falls back to the escaped plain Japanese, so a malformed import can
// never inject HTML or leave half a sentence behind.
const KANJI_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\u3005]/;
const KANA_CHAR = /[\u3041-\u3096\u30A1-\u30FA\u30FC]/;
const FURIGANA_PAIR = /([\u3400-\u4DBF\u4E00-\u9FFF\u3005\u3041-\u3096\u30A1-\u30FA\u30FC]+)《([\u3041-\u3096\u30A1-\u30FA\u30FC]+)》/g;

type FuriganaParts = { context: string; base: string; reading: string; after: string };

const furiganaParts = (run: string, reading: string): FuriganaParts | null => {
  const firstKanji = run.search(KANJI_CHAR);
  if (firstKanji < 0) return null;
  const context = run.slice(0, firstKanji);
  const word = run.slice(firstKanji);

  // Kana before the first kanji can be a word prefix such as お in お茶. When
  // the reading starts with that prefix, consume it so the ruby covers only the
  // kanji part and the prefix is rendered as plain text.
  let yomi = reading;
  for (let length = context.length; length > 0; length--) {
    const prefix = context.slice(context.length - length);
    if (yomi.startsWith(prefix)) {
      yomi = yomi.slice(prefix.length);
      break;
    }
  }

  // Okurigana is the kana the surface and reading share at the end.
  let cut = 0;
  while (
    cut < word.length &&
    cut < yomi.length &&
    KANA_CHAR.test(word[word.length - 1 - cut]) &&
    word[word.length - 1 - cut] === yomi[yomi.length - 1 - cut]
  ) {
    cut++;
  }
  const base = word.slice(0, word.length - cut);
  const after = word.slice(word.length - cut);
  const ruby = yomi.slice(0, yomi.length - cut);
  if (!base || !KANJI_CHAR.test(base) || !ruby) return null;
  return { context, base, reading: ruby, after };
};

export const furiganaHtml = (japanese: string, furigana: string) => {
  const plain = String(japanese ?? "");
  const annotated = String(furigana ?? "");
  if (!annotated) return esc(plain);
  const matches = [...annotated.matchAll(FURIGANA_PAIR)];
  if (!matches.length) return esc(plain);
  let out = "";
  let last = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    const gap = annotated.slice(last, index);
    if (/[《》]/.test(gap)) return esc(plain);
    const parts = furiganaParts(match[1], match[2]);
    if (!parts) return esc(plain);
    out += esc(gap) + esc(parts.context) +
      `<ruby>${esc(parts.base)}<rt>${esc(parts.reading)}</rt></ruby>` +
      esc(parts.after);
    last = index + match[0].length;
  }
  const tail = annotated.slice(last);
  if (/[《》]/.test(tail)) return esc(plain);
  return out + esc(tail);
};

const regexEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const highlight = (text: string | null | undefined, q: string) => {
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

// HTML response helper
export const html = (s: string, status = 200) =>
  new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8" } });
