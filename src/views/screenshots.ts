import { enc, esc, html } from "../html";
import { requestContext } from "../prefs";
import { markdownHtml } from "../markdown";
import { layout } from "./layout";
import { getScreenshot, listAllQueue, listForKanji, listSaved, shotThumbUrl, shotUrl, type Screenshot } from "../screenshots";

export const shotViewerUrl = (id: number, back?: string) =>
  `/shot/${id}/view${back ? `?back=${enc(back)}` : ""}`;

const pageOf = (url: URL) => {
  const value = Number(url.searchParams.get("page") ?? 1);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
};

const pager = (page: number, pages: number, make: (n: number) => string) => {
  if (pages <= 1) return "";
  return `<div class="shot-pager">
    ${page > 1 ? `<a class="pill ghost sm" href="${make(page - 1)}">← Previous</a>` : ""}
    <span class="sub">Page ${page} of ${pages}</span>
    ${page < pages ? `<a class="pill ghost sm" href="${make(page + 1)}">Next →</a>` : ""}
  </div>`;
};

const thumb = (row: Screenshot, className: string) =>
  `<a class="${className}" href="${shotUrl(row.id, row.hash)}" target="_blank" rel="noopener noreferrer"><img src="${shotThumbUrl(row.id, row.hash)}" alt="Screenshot #${row.id}" loading="lazy"></a>`;

const queueEditor = (row: Screenshot | undefined, total: number) => `<div class="shot-editor" id="shot-editor"${row ? "" : " hidden"}>
  <div class="shot-editor-head">
    <div><h2 class="h3">Edit screenshot</h2><span class="sub" id="shot-editor-count" aria-live="polite">${row ? `1 / ${total}` : ""}</span><span class="sub" id="shot-editor-meta"><span id="shot-editor-added">${row ? `Added ${esc(row.added_at)}` : ""}</span><span class="badge" id="shot-editor-source"${row?.source === "import" ? "" : " hidden"}>From app</span></span></div>
    <div class="shot-editor-nav">
      <button class="pill ghost sm" type="button" id="shot-editor-prev"${row && total > 1 ? "" : " disabled"}>← Previous</button>
      <button class="pill ghost sm" type="button" id="shot-editor-next"${row && total > 1 ? "" : " disabled"}>Next →</button>
    </div>
  </div>
  <div class="shot-editor-body">
    <div class="shot-editor-preview" id="shot-editor-preview">
      <img id="shot-editor-image" src="${row ? shotUrl(row.id, row.hash) : ""}" alt="${row ? `Screenshot #${row.id}` : ""}">
      <div class="shot-editor-overlay ${row?.position === 1 ? "top" : "bottom"}" id="shot-editor-overlay" aria-hidden="true"${row?.japanese ? "" : " hidden"}>
        <div class="shot-editor-overlay-jp" id="shot-editor-overlay-jp"${row?.japanese ? "" : " hidden"}>${row ? esc(row.japanese) : ""}</div>
        <div class="shot-editor-overlay-en" id="shot-editor-overlay-en"${row?.english ? "" : " hidden"}>${row ? esc(row.english) : ""}</div>
      </div>
    </div>
    <div class="shot-editor-fields">
      <div class="shot-field">
        <label class="shot-label">Japanese
          <textarea id="shot-editor-jp" rows="5" spellcheck="false" placeholder="Japanese text">${row ? esc(row.japanese) : ""}</textarea>
        </label>
        <button class="pill ghost sm" type="button" id="shot-editor-autofill" disabled>Autofill</button>
      </div>
      <div class="shot-field">
        <label class="shot-label">English
          <textarea id="shot-editor-en" rows="3" spellcheck="false" placeholder="English (optional)">${row ? esc(row.english) : ""}</textarea>
        </label>
        <button class="pill ghost sm" type="button" id="shot-editor-translate"${row ? "" : " disabled"}>Translate</button>
      </div>
      <label class="shot-position">Show text
        <select id="shot-editor-position" class="shot-position-select" aria-label="Text position">
          <option value="0"${row?.position === 1 ? "" : " selected"}>At the bottom</option>
          <option value="1"${row?.position === 1 ? " selected" : ""}>At the top</option>
        </select>
      </label>
      <div class="shot-error" id="shot-editor-error" role="alert" hidden></div>
      <div class="shot-editor-actions">
        <button class="pill dark sm" type="button" id="shot-editor-save"${row ? "" : " disabled"}>Save</button>
        <button class="pill ghost rem sm" type="button" id="shot-editor-delete"${row ? "" : " disabled"}>Delete</button>
      </div>
    </div>
  </div>
  <div class="shot-analysis" id="shot-analysis"${row && row.analysis.trim() ? "" : " hidden"}>
    <h3 class="shot-analysis-head">Analysis</h3>
    <div class="shot-analysis-body" id="shot-analysis-body">${row ? markdownHtml(row.analysis) : ""}</div>
  </div>
</div>`;

const queueData = (rows: Screenshot[]) => JSON.stringify(rows.map((row) => ({
  id: row.id,
  hash: row.hash,
  japanese: row.japanese,
  english: row.english,
  position: row.position,
  added_at: row.added_at,
  source: row.source,
  analysis_html: markdownHtml(row.analysis),
}))).replace(/</g, "\\u003c");

const galleryCard = (row: Screenshot) => `<article class="shot-gallery-card">
  ${thumb(row, "shot-gallery-thumb")}
  <div class="shot-gallery-text">
    <div class="shot-jp">${esc(row.japanese) || `<span class="sub">No Japanese text</span>`}</div>
    ${row.english ? `<div class="shot-en">${esc(row.english)}</div>` : ""}
    <span class="badge">${row.done ? "saved" : "unfinished"}${row.source === "import" ? " · from app" : ""}</span>
  </div>
</article>`;

// Saved screenshots are browsed in the editor, not as raw images, so the
// thumbnail links to the screenshot page and the Back link returns here.
const savedCard = (row: Screenshot, back: string) => `<article class="shot-gallery-card">
  <a class="shot-gallery-thumb" href="${shotViewerUrl(row.id, back)}" title="Edit screenshot #${row.id}"><img src="${shotThumbUrl(row.id, row.hash)}" alt="Screenshot #${row.id}" loading="lazy"></a>
  <div class="shot-gallery-text">
    <div class="shot-jp">${esc(row.japanese) || `<span class="sub">No Japanese text</span>`}</div>
    ${row.english ? `<div class="shot-en">${esc(row.english)}</div>` : ""}
    ${row.source === "import" ? `<span class="badge">from app</span>` : ""}
  </div>
</article>`;

export function screenshotViewerPage(id: number, back: string) {
  const row = getScreenshot(id);
  if (!row) return null;
  const theme = requestContext.getStore()?.theme ?? "light";
  const position = row.position === 1 ? "top" : "bottom";
  const body = `<div class="listhead"><div><h1>Screenshot</h1><p class="sub" id="shot-viewer-summary">${esc(row.japanese) || "No Japanese text"}</p>${row.source === "import" ? `<span class="badge">from app</span>` : ""}</div><div class="shot-viewer-actions"><a class="pill ghost sm" href="${esc(back)}">Back</a><button class="pill ghost rem sm" id="shot-viewer-delete" type="button">Delete</button></div></div>
    <div class="shot-viewer-layout" id="shot-viewer-layout">
      <div class="shot-viewer-frame">
        <img src="${shotUrl(row.id, row.hash)}" alt="Screenshot #${row.id}">
        <div class="shot-viewer-overlay ${position}" id="shot-viewer-overlay"${row.japanese ? "" : " hidden"}>
          <div class="shot-viewer-jp" id="shot-viewer-jp">${esc(row.japanese)}</div>
          <div class="shot-viewer-en" id="shot-viewer-en"${row.english ? "" : " hidden"}>${esc(row.english)}</div>
        </div>
      </div>
      <form class="card shot-edit-card" id="shot-edit-form">
        <div class="cardhead"><h2 class="h3">Edit screenshot</h2></div>
        <div class="shot-edit-fields">
          <div class="shot-field">
            <label class="shot-label">Japanese
              <textarea id="shot-edit-jp" rows="5" spellcheck="false">${esc(row.japanese)}</textarea>
            </label>
            <button class="pill ghost sm" type="button" id="shot-edit-autofill">Autofill</button>
          </div>
          <div class="shot-field">
            <label class="shot-label">English
              <textarea id="shot-edit-en" rows="3" spellcheck="false">${esc(row.english)}</textarea>
            </label>
            <button class="pill ghost sm" type="button" id="shot-edit-translate">Translate</button>
          </div>
          <label class="shot-position">Show text
            <select class="shot-position-select" id="shot-edit-position">
              <option value="0"${row.position === 1 ? "" : " selected"}>At the bottom</option>
              <option value="1"${row.position === 1 ? " selected" : ""}>At the top</option>
            </select>
          </label>
        </div>
        <div class="shot-edit-actions">
          <button class="pill dark sm" type="button" id="shot-edit-save">Save changes</button>
          <button class="pill ghost sm" type="button" id="shot-edit-cancel">Cancel</button>
        </div>
        <div class="shot-error" id="shot-edit-error" role="alert" hidden></div>
      </form>
    </div>
    ${row.analysis.trim() ? `<section class="card shot-analysis-card">
      <div class="cardhead"><h2 class="h3">Analysis</h2></div>
      <div class="shot-analysis-body">${markdownHtml(row.analysis)}</div>
    </section>` : ""}
    <div class="shot-toast" id="shot-viewer-saved" role="status" hidden>Changes saved.</div>
    <script type="application/json" id="shot-viewer-data">${JSON.stringify({ id: row.id, back }).replace(/</g, "\\u003c")}</script>
    <script src="/js/shot-viewer.js" defer></script>`;
  return html(layout("Screenshot – Kanji", body, { theme, back, active: "screenshots" }));
}

export function screenshotsPage(url: URL) {
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/screenshot";
  const requested = pageOf(url);
  const kanji = (url.searchParams.get("kanji") ?? "").trim();

  if (kanji) {
    const result = listForKanji(kanji, requested);
    const body = `<div class="listhead"><div><h1>Screenshots containing 「${esc(kanji)}」</h1><p class="sub">${result.total} screenshot${result.total === 1 ? "" : "s"}</p></div><a class="pill ghost sm" href="/screenshot">Back to screenshots</a></div>
      ${result.rows.length ? `<div class="shot-gallery">${result.rows.map(galleryCard).join("")}</div>` : `<div class="card listempty"><h2>No screenshots yet</h2><p class="sub">No screenshots contain this character.</p></div>`}
      ${pager(result.page, result.pages, (n) => `/screenshot?kanji=${enc(kanji)}${n > 1 ? `&page=${n}` : ""}`)}`;
    return html(layout(`Screenshots containing ${kanji} – Kanji`, body, { theme, back, active: "screenshots" }));
  }

  const rows = listAllQueue();
  const count = rows.length;
  const saved = listSaved(1);
  const uploadNotice = (() => {
    const uploaded = Number(url.searchParams.get("uploaded") ?? 0);
    const duplicates = Number(url.searchParams.get("duplicates") ?? 0);
    const skipped = Number(url.searchParams.get("skipped") ?? 0);
    const errors = Number(url.searchParams.get("errors") ?? 0);
    const uploadError = url.searchParams.get("uploadError");
    if (uploadError) return `<div class="setnotice err">${esc(uploadError)}</div>`;
    if (!uploaded && !duplicates && !skipped && !errors) return "";
    return `<div class="setnotice ok">${uploaded} uploaded${duplicates ? `, ${duplicates} duplicate` : ""}${skipped ? `, ${skipped} skipped` : ""}${errors ? `, ${errors} failed` : ""}.</div>`;
  })();

  const body = `<div class="listhead"><div><h1>Screenshots</h1><p class="sub">Attach screenshots to the kanji they contain.</p></div></div>
    ${uploadNotice}
    <section class="card shot-uploader">
      <div class="cardhead"><h2 class="h3">Add screenshots</h2><span class="sub">JPEG or PNG · max 5 at a time</span></div>
      <div class="shot-drop" id="shot-drop">
        <p>Drop images here or <label class="shot-choose">Choose images<input id="shot-file-input" type="file" accept="image/png,image/jpeg" multiple></label></p>
        <p class="sub">Images are converted to JPEG in your browser.</p>
      </div>
      <div class="shot-selected" id="shot-selected"></div>
      <div class="shot-upload-actions"><button class="pill dark" id="shot-upload" type="button" disabled>Upload</button><span class="sub" id="shot-progress"></span></div>
    </section>
    ${count ? `<p class="shot-counter" id="shot-counter" data-count="${count}"><a href="#queue"><span id="shot-counter-n">${count}</span> screenshot${count === 1 ? "" : "s"} unfinished</a></p>` : ""}
    <section id="queue" class="shot-queue-section">
      <div class="shot-queue-head"><h2>Queue</h2></div>
      <div class="shot-ocr-line" id="shot-ocr-line">
        <span class="shot-ocr-dot checking"></span><span id="shot-ocr-text">Checking OCR…</span>
        <button class="pill ghost sm" id="shot-ocr-recheck" type="button">Recheck</button>
      </div>
      ${queueEditor(rows[0], count)}
      <div class="card listempty" id="shot-empty"${count ? " hidden" : ""}><h2>No pending screenshots</h2><p class="sub">Upload one above.</p></div>
      <script type="application/json" id="shot-editor-data">${queueData(rows)}</script>
    </section>
    ${saved.total ? `<section class="shot-saved-section">
      <div class="shot-queue-head"><h2>Saved</h2><a class="pill ghost sm" href="/screenshot/all">View all ${saved.total}</a></div>
      <div class="shot-gallery">${saved.rows.map((row) => savedCard(row, "/screenshot")).join("")}</div>
    </section>` : ""}
    <script src="/js/screenshot-page.js" defer type="module"></script>`;

  return html(layout("Screenshots – Kanji", body, { theme, back, active: "screenshots" }));
}

export function savedScreenshotsPage(url: URL) {
  const theme = requestContext.getStore()?.theme ?? "light";
  const back = requestContext.getStore()?.back ?? "/screenshot";
  const requested = pageOf(url);
  const result = listSaved(requested);
  const here = `/screenshot/all${result.page > 1 ? `?page=${result.page}` : ""}`;
  const body = `<div class="listhead"><div><h1>Saved screenshots</h1><p class="sub">${result.total} screenshot${result.total === 1 ? "" : "s"}</p></div><a class="pill ghost sm" href="/screenshot">Back to screenshots</a></div>
    ${result.rows.length ? `<div class="shot-gallery">${result.rows.map((row) => savedCard(row, here)).join("")}</div>` : `<div class="card listempty"><h2>Nothing saved yet</h2><p class="sub">Saving a screenshot from the queue puts it here.</p></div>`}
    ${pager(result.page, result.pages, (n) => `/screenshot/all${n > 1 ? `?page=${n}` : ""}`)}`;
  return html(layout("Saved screenshots – Kanji", body, { theme, back, active: "screenshots" }));
}
