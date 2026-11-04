import { enc, esc } from "./html";

// Story markup: =keyword=  _component_  ?note?  #link#  (markers may nest, except inside a link).
// Works on the raw text and escapes every piece, so the "#" in HTML entities can never be mistaken for a marker.
const STORY_MARKUP = /=([^=\n]+)=|_([^_\n]+)_|\?([^?\n]+)\?|#([^#\n]+)#/g;
export function storyHtml(s: string): string {
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
