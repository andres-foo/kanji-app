import { enc, html } from "../html";
import { requestContext } from "../prefs";
import { REVIEW_BUTTONS, REVIEW_KEYS, REVIEW_PAD } from "../review";
import { kanjiRedesignView } from "./design";
import { kanjiRedesignEditView } from "./kanji-edit";
import { messagePage } from "./message";
import { layout } from "./layout";

const reviewBar = (literal: string) =>
  REVIEW_BUTTONS.map(([id, label], i) =>
    `<form method="post" action="/review/${enc(literal)}/${id}"><button class="reviewbtn ${id}" type="submit" aria-keyshortcuts="${REVIEW_KEYS[i]}"><kbd class="kbd">${REVIEW_KEYS[i]}</kbd><span class="pad">${REVIEW_PAD[i]}</span>${label}</button></form>`,
  ).join("");

export async function kanjiPage(literal: string, url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = `${url.pathname}${url.search}`;
  const editing = url.searchParams.get("edit") === "1";
  const reviewing = url.searchParams.get("review") === "1";
  const view = editing ? await kanjiRedesignEditView(literal, q) : await kanjiRedesignView(literal, "/kanji", q);
  if (!view) return messagePage("Kanji not found", `“${literal}” is not in the database.`, 404);
  const bar = reviewing && !editing ? reviewBar(literal) : "";
  return html(layout(view.title, view.body, { theme, back, lab: false, bar, searchValue: q }));
}
