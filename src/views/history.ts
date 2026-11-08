import { enc, esc, html } from "../html";
import { historyLimit, kanjiHistory, searchHistory } from "../history";
import { requestContext } from "../prefs";
import { layout } from "./layout";
import { messagePage } from "./message";

export function historyPage() {
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/history";
  const limit = historyLimit();

  try {
    const searches = searchHistory(limit);
    const kanji = kanjiHistory(limit);

    const searchRows = searches.length
      ? searches.map((q) => `<a class="historyquery" href="/?q=${enc(q)}">${esc(q)}</a>`).join("")
      : `<p class="sub historyempty">No searches yet.</p>`;

    const kanjiTiles = kanji.length
      ? `<div class="lgrid">${kanji.map((k) => {
          const state = k.added === 1 ? (k.unfinished === 1 ? "unf" : "in") : "";
          return `<a class="lkt${state ? ` ${state}` : " notadded"}" href="/kanji/${enc(k.literal)}" aria-label="Open ${esc(k.literal)}">${esc(k.literal)}</a>`;
        }).join("")}</div>`
      : `<p class="sub historyempty">No kanji visits yet.</p>`;

    const body = `<div class="listhead"><div><h1>History</h1><p class="sub">Recent searches and kanji visits.</p></div></div>
      <div class="grid">
        <div class="card" style="grid-column:span 6">
          <div class="stathead"><div><h2>Searches</h2><p class="sub">Click a query to search again.</p></div></div>
          <div class="historysearches">${searchRows}</div>
        </div>
        <div class="card" style="grid-column:span 6">
          <div class="stathead"><div><h2>Kanji visited</h2><p class="sub">Click a kanji to open it again.</p></div></div>
          ${kanjiTiles}
        </div>
      </div>`;

    return html(layout("History – Kanji", body, { theme, back, active: "history" }));
  } catch (e) {
    return messagePage("History error", `Could not read the history: ${(e as Error).message}.`, 500);
  }
}
