import { esc } from "../html";
import type { Kanji } from "../types";

export type Priority = "high" | "medium" | "low" | "zero";

// each level is "high" once it is within the accumulated range, the next level is "medium", the rest "low"
// (the very last tier, where only the hardest levels remain, is "medium" for everything left)
export const jlptPriority = (jlpt: number, total: number): Priority => {
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

export const kankenPriority = (kanken: number, total: number): Priority => {
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

export const jlptBadge = (k: Pick<Kanji, "jlpt">, total: number) =>
  k.jlpt ? `<span class="b priority-${jlptPriority(Number(k.jlpt), total)}">N${esc(k.jlpt)}</span>` : "";
export const kankenBadge = (k: Pick<Kanji, "kanken">, total: number, label = "Kanken ") =>
  k.kanken ? `<span class="b priority-${kankenPriority(Number(k.kanken), total)}">${label}${esc(k.kanken)}</span>` : "";

// the database separates meanings with ";": show them separated by commas
const meaningsList = (s: unknown) => String(s ?? "").split(";").map((m) => m.trim()).filter(Boolean);
// synonyms after a numbered definition stay on its line until the next (n) marker
export const meaningGroups = (s: unknown) => {
  const groups: string[] = [];
  const startsDefinition = /^(?:\([^)]*\)\s*)?\(\d+\)(?:\s|$)/;
  for (const part of meaningsList(s)) {
    if (part === "(P)") continue;
    if (!groups.length || startsDefinition.test(part)) groups.push(part);
    else groups[groups.length - 1] += `, ${part}`;
  }
  return groups;
};
export const meaningsText = (s: unknown) => meaningsList(s).join(", ");
export const meanings = (s: unknown) => esc(meaningsText(s));
export const readingList = (s: string | null) => (s ? s.split(/[、,;\s]+/).filter(Boolean).join("、") : "");
export const keywordText = (s: string | null) => (s ? s.split(";").map((k) => k.trim()).filter(Boolean).join(", ") : "");
export const splitKanjiMarker = (kanji: string) => {
  const match = /^(.*?)\s*(\([^)]*\))$/.exec(kanji);
  return match ? { text: match[1].trim(), marker: match[2] } : { text: kanji, marker: "" };
};
