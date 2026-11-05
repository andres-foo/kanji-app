import { esc } from "../html";

type Options = { theme: string; back: string; lab?: boolean };

// the shared shell for pages that have been moved to the redesign
export const redesignLayout = (title: string, body: string, { theme, back, lab = false }: Options) => `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/redesign.css">
</head>
<body>
<div class="panel">
<nav class="nav">
  <a class="brand" href="/" style="text-decoration:none;color:inherit">KANJI</a>
  ${lab ? `<span class="labtag">design lab</span>` : ""}
  <div class="navlinks">
    <a href="/my-list">My List</a><a href="/jlpt">JLPT</a><a href="/kanken">Kanken</a><a href="/stats">Stats</a>
  </div>
  <div class="navright">
    <form class="navsearch" action="/" method="get" role="search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input name="q" placeholder="Search" aria-label="Search">
    </form>
    <a class="pill dark" href="/review">Review</a>
    <form class="themeswitch" method="post" action="/theme">
      <input type="hidden" name="theme" value="${theme === "dark" ? "light" : "dark"}">
      <input type="hidden" name="back" value="${esc(back)}">
      <button class="switch" type="submit" aria-label="Switch to ${theme === "dark" ? "light" : "dark"} theme" title="Switch theme"><span class="knob"></span></button>
    </form>
    <a class="iconbtn" href="/settings" aria-label="Settings"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></a>
  </div>
</nav>
${body}
</div>
<script src="/js/layout.js" defer></script>
</body></html>`;
