import { esc } from "../html";
import { dueCounts } from "../review";

type Options = { theme: string; back: string; lab?: boolean; bar?: string; barClass?: string; searchValue?: string; active?: string };

const HOME_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.6 12 3.4l9 7.2"/><path d="M5.6 9.6V20h12.8V9.6"/><path d="M10 20v-4.6h4V20"/></svg>`;
const DOTS_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>`;
const SEARCH_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>`;
const GEAR_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
const BOLT_ICON = `<svg class="revicon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>`;

// The sections that sit behind the dots button; the link list stays short.
const MENU_LINKS: [key: string, href: string, label: string][] = [
  ["components", "/components", "COMPONENTS"],
  ["screenshots", "/screenshot", "SCREENSHOTS"],
];

// the shared shell for every page
export const layout = (title: string, body: string, { theme, back, lab = false, bar = "", barClass = "", searchValue = "", active = "" }: Options) => {
  const d = dueCounts();
  const total = d.fresh + d.today + d.overdue;
  const menuOpen = MENU_LINKS.some(([key]) => key === active);
  const menu = MENU_LINKS.map(([, href, label]) => `<a role="menuitem" href="${href}">${label}</a>`).join("");
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<script>try{if(localStorage.getItem("kanji_input")==="pad")document.documentElement.dataset.input="pad";}catch(e){}</script>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="panel">
<nav class="nav">
  <div class="navlinks" role="navigation" aria-label="Main">
    <a class="navhome${active === "" ? " on" : ""}" href="/" aria-label="Dashboard" title="Dashboard">${HOME_ICON}<span>DASHBOARD</span></a>
    <a class="${active === "my-list" ? "on" : ""}" href="/my-list">MY LIST</a><a class="${active === "jlpt" ? "on" : ""}" href="/jlpt">JLPT</a>
    <details class="navover"><summary class="navdots${menuOpen ? " on" : ""}" aria-label="More sections" title="More sections">${DOTS_ICON}</summary><div class="navmenu" role="menu">${menu}</div></details>
  </div>
  ${lab ? `<span class="labtag">design lab</span>` : ""}
  <form class="navsearch" action="/" method="get" role="search" autocomplete="off">
    ${SEARCH_ICON}
    <input name="q" value="${esc(searchValue)}" placeholder="Search" aria-label="Search" role="combobox" autocomplete="off" autocapitalize="off" spellcheck="false" aria-autocomplete="list" aria-controls="search-suggest" aria-expanded="false">
    <a class="navcomp${active === "components-search" ? " on" : ""}" href="/components/search" aria-label="Find kanji by components" title="Find by components"><span class="navcomp-glyph" aria-hidden="true">字</span><span class="navcomp-text">Find by components</span></a>
  </form>
  <div class="navright">
    <a class="pill dark review" href="/review" aria-label="Review: ${total} due (${d.fresh} new, ${d.today} due today, ${d.overdue} overdue)">${BOLT_ICON}<span class="rlabel">REVIEW</span><span class="rnums"><span class="rn-fresh">${d.fresh}</span><span class="rn-dot">·</span><span class="rn-today">${d.today}</span><span class="rn-dot">·</span><span class="rn-overdue">${d.overdue}</span></span></a>
    <a class="iconbtn" href="/settings" aria-label="Settings">${GEAR_ICON}</a>
  </div>
</nav>
${bar ? `<div class="reviewbar${barClass ? ` ${barClass}` : ""}">${bar}</div>` : ""}
${body}
</div>
${bar ? `<script src="/js/review-keys.js" defer></script>` : ""}
<script src="/js/search-romaji.js" defer></script>
<script src="/js/search-suggest.js" defer></script>
<script src="/js/nav-menu.js" defer></script>
<script src="/js/layout.js" defer></script>
</body></html>`;
};
