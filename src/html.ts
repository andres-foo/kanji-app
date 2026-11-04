// Text and HTML helpers shared by the views.
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
export const likeEsc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
export const toKata = (s: string) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
export const toHira = (s: string) => s.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export const nullsLast = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);
export const enc = encodeURIComponent;

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
