import { esc, html } from "../html";
import { requestContext } from "../prefs";
import { layout } from "./layout";

type MessageAction = { href: string; label: string };

export function messagePage(title: string, message: string, status = 200, action: MessageAction = { href: "/", label: "Back to dashboard" }) {
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/";
  const crumb = status >= 400 ? "Error" : "Notice";
  const body = `<div class="qpage"><div class="qcard">
    <div class="crumb">${crumb}</div>
    <h1>${esc(title)}</h1>
    <p class="sub">${esc(message)}</p>
    <a class="pill dark" href="${esc(action.href)}">${esc(action.label)}</a>
  </div></div>`;
  return html(layout(title, body, { theme, back }), status);
}
