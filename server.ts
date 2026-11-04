import { PORT } from "./src/config";
import { db } from "./src/db";
import { esc, html, enc } from "./src/html";
import { requestContext, themeFrom, detailsOpenFrom, sameOrigin, safeBack } from "./src/prefs";
import { pickReviewKanji, saveReview, type ReviewResult } from "./src/review";
import { layout } from "./src/views/layout";
import { reviewNext, reviewPage } from "./src/views/review";
import { DELTA_FIELDS, settingsPage } from "./src/views/settings";
import { statsPage } from "./src/views/stats";
import { kanjiPage } from "./src/views/kanji";
import { findImage, imagePath, kanjiExists, MAX_IMAGE_BYTES, removeImages, sniffImage } from "./src/images";
import { startScore, type SettingKey } from "./src/settings";
import { MAX_SCORE, MIN_SCORE } from "./src/mastery";
import { home } from "./src/views/home";
import { levelPage, myListPage } from "./src/views/lists";

// flip examples.added between 0 and 1, then go back to where the user was
async function toggleWord(req: Request, id: number) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  try {
    db.run(`UPDATE examples SET added = CASE WHEN COALESCE(added, 0) = 1 THEN 0 ELSE 1 END WHERE id = ?`, [id]);
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not update the word: ${esc((e as Error).message)}. Is the database file writable?</div>`), 500);
  }
  return new Response(null, { status: 303, headers: { location: `${back}#w${id}` } });
}

// flip kanjis.added between 0 and 1 (a newly added kanji starts out unfinished), then go back to the kanji page
async function toggleKanji(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  try {
    db.run(
      `UPDATE kanjis
       SET added = CASE WHEN COALESCE(added, 0) = 1 THEN 0 ELSE 1 END,
           unfinished = CASE WHEN COALESCE(added, 0) = 1 THEN 0 ELSE 1 END,
           score = CASE WHEN COALESCE(added, 0) = 1 THEN score ELSE ? END,
           due_date = CASE WHEN COALESCE(added, 0) = 1 THEN due_date ELSE NULL END,
           last_reviewed = CASE WHEN COALESCE(added, 0) = 1 THEN last_reviewed ELSE NULL END
       WHERE literal = ?`,
      [startScore(), literal],
    );
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not update the kanji: ${esc((e as Error).message)}. Is the database file writable?</div>`), 500);
  }
  return new Response(null, { status: 303, headers: { location: back } });
}

// save the edit form: text fields (empty -> NULL) and the checkboxes (checked -> 1, unchecked -> 0).
// Ticking "Added" on a kanji that was not added starts it from scratch (starting score, due now); unticking it keeps its score.
async function updateKanji(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const text = (name: string) => String(form.get(name) ?? "").replace(/\r\n?/g, "\n").trim() || null;
  const flag = (name: string) => (form.get(name) ? 1 : 0);
  const added = flag("added");
  try {
    // the CASE expressions see the old row, so they can tell that the kanji is being added right now
    const result = db.run(
      `UPDATE kanjis
       SET keyword = ?, components = ?, other_forms = ?, related = ?, story = ?, unfinished = ?, is_component = ?,
           score = CASE WHEN COALESCE(added, 0) = 0 AND ? = 1 THEN ? ELSE score END,
           due_date = CASE WHEN COALESCE(added, 0) = 0 AND ? = 1 THEN NULL ELSE due_date END,
           last_reviewed = CASE WHEN COALESCE(added, 0) = 0 AND ? = 1 THEN NULL ELSE last_reviewed END,
           added = ?
       WHERE literal = ?`,
      [text("keyword"), text("components"), text("other_forms"), text("related"), text("story"), flag("unfinished"), flag("is_component"), added, startScore(), added, added, added, literal],
    );
    if (!result.changes) return html(layout("Not found", "", `<div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not update the kanji: ${esc((e as Error).message)}. Is the database file writable?</div>`), 500);
  }
  return new Response(null, { status: 303, headers: { location: back } });
}

const imageError = (msg: string, status: number) =>
  html(layout("Error", "", `<div class="box empty">${esc(msg)}</div>`), status);

// replace the kanji's image with an uploaded jpg/png and make sure no file of the other format remains
async function uploadImage(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  if (!kanjiExists(literal)) return imageError(`“${literal}” is not in the database.`, 404);
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return imageError("No image was selected.", 400);
  if (file.size > MAX_IMAGE_BYTES) return imageError(`The image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) return imageError("Only JPEG and PNG images are supported.", 415);
  try {
    await Bun.write(imagePath(literal, ext), bytes);
  } catch (e) {
    return imageError(`Could not save the image: ${(e as Error).message}. Is the images folder writable?`, 500);
  }
  const problem = await removeImages(literal, ext);
  if (problem) return imageError(problem, 500);
  return new Response(null, { status: 303, headers: { location: back } });
}

// delete the kanji's image (every format) and verify it is gone
async function deleteImage(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  if (!kanjiExists(literal)) return imageError(`“${literal}” is not in the database.`, 404);
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const problem = await removeImages(literal);
  if (problem) return imageError(problem, 500);
  return new Response(null, { status: 303, headers: { location: back } });
}

// store the explicit theme (or clear it) in a cookie, then go back to where the user was
async function setTheme(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const value = String(form.get("theme") ?? "");
  const theme: Theme | null = value === "light" || value === "dark" ? value : null;
  const headers = new Headers({ location: safeBack(form.get("back")) });
  headers.set("set-cookie", theme
    ? `kanji_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`
    : `kanji_theme=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
  return new Response(null, { status: 303, headers });
}

// remember whether the details table is shown, then go back to the kanji page
async function toggleDetails(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const open = form.get("details") === "open";
  const headers = new Headers({ location: safeBack(form.get("back")) });
  headers.set("set-cookie", `kanji_details=${open ? "open" : "closed"}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
  return new Response(null, { status: 303, headers });
}

// ---------- review ----------
async function reviewResult(req: Request, literal: string, result: ReviewResult) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  try {
    const found = saveReview(literal, result);
    if (!found) return html(layout("Not found", "", `<div class="box empty">“${esc(literal)}” is not in the database.</div>`), 404);
  } catch (e) {
    return html(layout("Error", "", `<div class="box empty">Could not save the review: ${esc((e as Error).message)}. Is the database file writable, and do the last_reviewed and due_date columns exist?</div>`), 500);
  }
  return new Response(null, { status: 303, headers: { location: "/review" } });
}

// ---------- settings page ----------
async function saveSettings(req: Request, url: URL) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData();
  const submitted: Record<string, string> = {};
  const levels: Mastery[] = [];
  const deltas: [SettingKey, number][] = [];
  const errors: string[] = [];
  for (const f of DELTA_FIELDS) {
    const text = String(form.get(f.key) ?? "").trim();
    submitted[f.key] = text;
    const n = Number(text);
    if (text === "" || !Number.isInteger(n) || n < -10 || n > 10) errors.push(`${f.label} must be a whole number from -10 to 10.`);
    else deltas.push([f.key, n]);
  }
  for (let score = MIN_SCORE; score <= MAX_SCORE; score++) {
    const label = String(form.get(`label_${score}`) ?? "").trim();
    const daysText = String(form.get(`days_${score}`) ?? "").trim();
    submitted[`label_${score}`] = label;
    submitted[`days_${score}`] = daysText;
    const days = Number(daysText);
    if (!label) errors.push(`Score ${score}: the label cannot be empty.`);
    else if (label.length > 30) errors.push(`Score ${score}: the label is too long (30 characters at most).`);
    if (daysText === "" || !Number.isInteger(days) || days < 1 || days > 3650) errors.push(`Score ${score}: days must be a whole number from 1 to 3650.`);
    levels.push({ score, label, interval_days: days });
  }
  if (errors.length) return settingsPage(url, errors, submitted, 400);
  try {
    db.transaction(() => {
      for (const [key, value] of deltas) {
        db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
      }
      for (const m of levels) {
        db.run(
          `INSERT INTO mastery_levels (score, label, interval_days) VALUES (?, ?, ?)
           ON CONFLICT(score) DO UPDATE SET label = excluded.label, interval_days = excluded.interval_days`,
          [m.score, m.label, m.interval_days],
        );
      }
    })();
  } catch (e) {
    return settingsPage(url, [`Could not save the settings: ${(e as Error).message}. Do the settings and mastery_levels tables exist?`], submitted, 500);
  }
  return new Response(null, { status: 303, headers: { location: "/settings?saved=1" } });
}

// sets every added kanji to the starting score and makes it due now (no due date, never reviewed)
async function resetScores(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const start = startScore();
  try {
    const res = db.run(`UPDATE kanjis SET score = ?, due_date = NULL, last_reviewed = NULL WHERE COALESCE(added, 0) = 1`, [start]);
    return new Response(null, { status: 303, headers: { location: `/settings?reset=${res.changes}&to=${start}` } });
  } catch (e) {
    return settingsPage(new URL(req.url), [`Could not reset the scores: ${(e as Error).message}. Is the database file writable, and do the last_reviewed and due_date columns exist?`], undefined, 500);
  }
}

// ---------- server ----------
const STATIC_FILES: Record<string, [string, string]> = {
  "/styles.css": ["public/styles.css", "text/css; charset=utf-8"],
  "/js/layout.js": ["public/js/layout.js", "text/javascript; charset=utf-8"],
  "/js/story-editor.js": ["public/js/story-editor.js", "text/javascript; charset=utf-8"],
  "/js/review-keys.js": ["public/js/review-keys.js", "text/javascript; charset=utf-8"],
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
      try { path = decodeURIComponent(url.pathname); } catch { return html(layout("Bad request", "", `<div class="box empty">Bad request.</div>`), 400); }

      if (path === "/details/toggle") return req.method === "POST" ? toggleDetails(req) : new Response("Method not allowed", { status: 405 });
      if (path === "/theme") return req.method === "POST" ? setTheme(req) : new Response("Method not allowed", { status: 405 });
      if (path === "/stats") return statsPage(url);
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
      const toggle = path.match(/^\/words\/(\d+)\/toggle$/);
      if (toggle) {
        return req.method === "POST" ? toggleWord(req, Number(toggle[1])) : new Response("Method not allowed", { status: 405 });
      }
      if (path === "/") return home(url);
      if (path === "/my-list") return myListPage(url);
      if (path === "/jlpt") return levelPage("jlpt", "JLPT", "jlpt");
      if (path === "/kanken") return levelPage("kanken", "KANKEN", "kanken");
      if (path.startsWith("/kanji/")) return kanjiPage(path.slice(7), url);
      if (path.startsWith("/img/")) {
        const f = await findImage(path.slice(5));
        return f ? new Response(f, { headers: { "cache-control": "no-cache" } }) : new Response("Not found", { status: 404 });
      }
      return html(layout("Not found", "", `<div class="box empty">Page not found.</div>`), 404);
    });
  },
});

console.log(`Kanji app running at http://localhost:${PORT}`);