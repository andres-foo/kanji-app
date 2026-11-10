import { PORT } from "./src/config";
import { requestContext, themeFrom, detailsOpenFrom } from "./src/prefs";
import { findImage } from "./src/images";
import type { ReviewResult } from "./src/review";
import { home } from "./src/views/home";
import { historyPage } from "./src/views/history";
import { levelPage, myListPage } from "./src/views/lists";
import { kanjiPage } from "./src/views/kanji";
import { designKanjiPage } from "./src/views/design";
import { componentsPage } from "./src/views/components";
import { componentSearchPage } from "./src/views/component-search";
import { groupComponents } from "./src/routes/components";
import { componentResults, componentSuggestions } from "./src/routes/component-search";
import { messagePage } from "./src/views/message";
import { reviewNext, reviewPage } from "./src/views/review";
import { settingsPage } from "./src/views/settings";
import { toggleWord, toggleKanji, updateKanji } from "./src/routes/kanji";
import { uploadImage, deleteImage } from "./src/routes/images";
import { kanjiPhrases } from "./src/routes/phrases";
import { setTheme, toggleDetails } from "./src/routes/prefs";
import { reviewResult } from "./src/routes/review";
import { saveSettings, resetScores } from "./src/routes/settings";

// ---------- server ----------
const STATIC_FILES: Record<string, [string, string]> = {
  "/styles.css": ["public/styles.css", "text/css; charset=utf-8"],
  "/js/layout.js": ["public/js/layout.js", "text/javascript; charset=utf-8"],
  "/js/search-romaji.js": ["public/js/search-romaji.js", "text/javascript; charset=utf-8"],
  "/js/story-editor.js": ["public/js/story-editor.js", "text/javascript; charset=utf-8"],
  "/js/review-keys.js": ["public/js/review-keys.js", "text/javascript; charset=utf-8"],
  "/js/stroke.js": ["public/js/stroke.js", "text/javascript; charset=utf-8"],
  "/js/components.js": ["public/js/components.js", "text/javascript; charset=utf-8"],
  "/js/component-search.js": ["public/js/component-search.js", "text/javascript; charset=utf-8"],
  "/js/component-field.js": ["public/js/component-field.js", "text/javascript; charset=utf-8"],
  "/js/phrase-more.js": ["public/js/phrase-more.js", "text/javascript; charset=utf-8"],
};

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const asset = STATIC_FILES[url.pathname];
    if (asset) return new Response(Bun.file(asset[0]), { headers: { "content-type": asset[1], "cache-control": "no-cache" } });

    if (url.pathname.startsWith("/fonts/")) {
      // the Jigmo files live in public/fonts; only those exact names are served
      const name = url.pathname.slice("/fonts/".length);
      if (!/^Jigmo\d*\.ttf$/.test(name)) return new Response("Not found", { status: 404 });
      const file = Bun.file(`public/fonts/${name}`);
      if (!(await file.exists())) return new Response("Not found", { status: 404 });

      return new Response(file, {
        headers: {
          "Content-Type": "font/ttf",
          "Access-Control-Allow-Origin": "*", // allows the tablet to download it
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    return requestContext.run({ theme: themeFrom(req), detailsOpen: detailsOpenFrom(req), back: url.pathname + url.search }, async () => {
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { return messagePage("Bad request", "The address could not be read.", 400); }

      if (path === "/details/toggle") return req.method === "POST" ? toggleDetails(req) : new Response("Method not allowed", { status: 405 });
      if (path === "/theme") return req.method === "POST" ? setTheme(req) : new Response("Method not allowed", { status: 405 });
      if (path === "/settings/reset-scores") return req.method === "POST" ? resetScores(req) : new Response("Method not allowed", { status: 405 });
      if (path === "/settings") return req.method === "POST" ? saveSettings(req, url) : settingsPage(url);
      if (path === "/review") return reviewNext();
      const reviewShow = path.match(/^\/review\/([^/]+)$/);
      if (reviewShow) return reviewPage(reviewShow[1]);
      const reviewDone = path.match(/^\/review\/([^/]+)\/(good|neutral|bad|easy)$/);
      if (reviewDone) {
        return req.method === "POST" ? reviewResult(req, reviewDone[1], reviewDone[2] as ReviewResult) : new Response("Method not allowed", { status: 405 });
      }
      const kanjiToggle = path.match(/^\/kanji\/([^/]+)\/toggle$/);
      if (kanjiToggle) {
        return req.method === "POST" ? toggleKanji(req, kanjiToggle[1]) : new Response("Method not allowed", { status: 405 });
      }
      const kanjiImage = path.match(/^\/kanji\/([^/]+)\/image(\/delete)?$/);
      if (kanjiImage) {
        if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
        return kanjiImage[2] ? deleteImage(req, kanjiImage[1]) : uploadImage(req, kanjiImage[1]);
      }
      const kanjiEdit = path.match(/^\/kanji\/([^/]+)\/edit$/);
      if (kanjiEdit) {
        return req.method === "POST" ? updateKanji(req, kanjiEdit[1]) : new Response("Method not allowed", { status: 405 });
      }
      const kanjiPhraseList = path.match(/^\/kanji\/([^/]+)\/phrases$/);
      if (kanjiPhraseList) {
        return req.method === "GET" ? kanjiPhrases(kanjiPhraseList[1], url) : new Response("Method not allowed", { status: 405 });
      }
      const toggle = path.match(/^\/words\/(\d+)\/toggle$/);
      if (toggle) {
        return req.method === "POST" ? toggleWord(req, Number(toggle[1])) : new Response("Method not allowed", { status: 405 });
      }
      if (path === "/") return home(url);
      if (path === "/my-list") return myListPage(url);
      if (path === "/history") return historyPage();
      if (path === "/components/search") return componentSearchPage(url);
      if (path === "/components/search/suggest") return componentSuggestions(url);
      if (path === "/components/search/results") return componentResults(url);
      if (path === "/components") return componentsPage();
      if (path === "/components/group") return req.method === "POST" ? groupComponents(req) : new Response("Method not allowed", { status: 405 });
      if (path === "/jlpt") return levelPage("jlpt", "JLPT", "jlpt", url);
      if (path === "/kanken") return levelPage("kanken", "KANKEN", "kanken", url);
      const designKanji = path.match(/^\/design\/kanji\/([^/]+)$/);
      if (designKanji) return designKanjiPage(designKanji[1]);
      if (path.startsWith("/kanji/")) return kanjiPage(path.slice(7), url);
      if (path.startsWith("/img/")) {
        const f = await findImage(path.slice(5));
        return f ? new Response(f, { headers: { "cache-control": "no-cache" } }) : new Response("Not found", { status: 404 });
      }
      return messagePage("Page not found", "That page doesn’t exist. Use the search bar above, or head back to the dashboard.", 404);
    });
  },
});

console.log(`Kanji app running at http://localhost:${PORT}`);