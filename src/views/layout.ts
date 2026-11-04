import { addedCount } from "../db";
import { dueCounts } from "../review";
import { esc } from "../html";
import { shortQuery } from "../search";
import { requestContext, type Theme } from "../prefs";

const gearIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
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

// dropdown with the three list pages: click or tap the label to open it (it also opens on hover where hovering exists).
// The label says "Lists" and only shows a list name, in the accent colour, while one of the list pages is open.
const listsMenu = (active: string) => {
  const items = [["my-list", `MY LIST (${addedCount()})`], ["jlpt", "JLPT"], ["kanken", "KANKEN"]] as const;
  const onList = items.some(([id]) => id === active);
  const current = items.find(([id]) => id === active) ?? items[0];
  const links = items.map(([id, label]) => `<a href="/${id}"${active === id ? ' class="on" aria-current="page"' : ""}>${label}</a>`).join("");
  // the label says "Lists" until you are on one of the list pages, then it shows that page's name in the accent colour
  return `<div class="dd"><button type="button" class="ddlabel${onList ? " on" : ""}" aria-haspopup="menu" aria-expanded="false">${onList ? current[1] : "Lists"}</button><div class="ddmenu"><nav class="ddbox" aria-label="Lists">${links}</nav></div></div>`;
};

// the navbar counter: the queue size split into its three due states, each number in its own colour
const dueNumber = (value: number, cls: string, label: string) =>
  `<span class="rn ${cls}" title="${value} ${label}">${value}</span>`;
const reviewNavButton = () => {
  const d = dueCounts();
  const total = d.fresh + d.today + d.overdue;
  return `<a class="reviewbtn small" href="/review" aria-label="Review: ${total} due (${d.fresh} new, ${d.today} due today, ${d.overdue} overdue)">Review (${dueNumber(d.fresh, "rn-fresh", "with no due date")}<span class="rnsep" aria-hidden="true">·</span>${dueNumber(d.today, "rn-today", "due today")}<span class="rnsep" aria-hidden="true">·</span>${dueNumber(d.overdue, "rn-overdue", "overdue")})</a>`;
};

export const layout = (title: string, q: string, body: string, active = "", bar?: string) => {
  const ctx = requestContext.getStore();
  const theme = ctx?.theme;
  const back = ctx?.back ?? "/";
  return `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<script>try{if(localStorage.getItem("kanji_input")==="pad")document.documentElement.dataset.input="pad";}catch(e){}</script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;700&family=Nunito:wght@500;700;800;900&display=swap">
<link rel="stylesheet" href="/styles.css"></head><body>
<header>
<div class="navl">${listsMenu(active)}${reviewNavButton()}<a class="reviewbtn small${active === "stats" ? " on" : ""}" href="/stats">Stats</a></div>
<form class="s" action="/" method="get" role="search">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
<input name="q" value="${esc(q)}" placeholder="Kanji, keyword, meaning or reading" aria-label="Search" autocomplete="off" required ${shortQuery(q) && !bar ? "autofocus" : ""}>
${q ? `<a class="clear" href="/" aria-label="Clear search">×</a>` : ""}
</form><div class="hr">${themeToggle(back)}<a class="theme-btn" href="/settings" aria-label="Settings" title="Settings">${gearIcon}<span>Settings</span></a></div></header>
${bar ? `<div class="reviewbar">${bar}</div>` : ""}
<main>${body}</main>
${bar ? '<script src="/js/review-keys.js" defer></script>' : ""}
<script src="/js/layout.js" defer></script></body></html>`;
};
