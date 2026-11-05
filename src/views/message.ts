import { esc, html } from "../html";
import { requestContext } from "../prefs";
import { redesignLayout } from "./redesign-layout";

export function messagePage(title: string, message: string, status = 200) {
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/";
  const body = `<div class="qpage"><div class="qcard">
    <div class="crumb">Kanji</div>
    <h1>${esc(title)}</h1>
    <p class="sub">${esc(message)}</p>
    <a class="pill dark" href="/">Back to search</a>
  </div></div>`;
  return html(redesignLayout(title, body, { theme, back }), status);
}
