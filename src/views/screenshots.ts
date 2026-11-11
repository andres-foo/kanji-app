import { enc, esc, html } from "../html";
import { requestContext } from "../prefs";
import { layout } from "./layout";
import { getScreenshot, listForKanji, listQueue, shotThumbUrl, shotUrl, unfinishedCount, type Screenshot } from "../screenshots";

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

const thumb = (row: Screenshot, className = "shot-thumb") =>
  `<a class="${className}" href="/shot/${row.id}" target="_blank" rel="noopener noreferrer"><img src="${shotThumbUrl(row.id)}" alt="Screenshot #${row.id}" loading="lazy"></a>`;

const queueCard = (row: Screenshot) => `<article class="shot-card" data-id="${row.id}">
  ${thumb(row)}
  <div class="shot-fields">
    <label class="shot-label">Japanese
      <textarea class="shot-jp" rows="3" spellcheck="false" placeholder="Japanese text">${esc(row.japanese)}</textarea>
    </label>
    <label class="shot-label">English
      <textarea class="shot-en" rows="2" spellcheck="false" placeholder="English (optional)">${esc(row.english)}</textarea>
    </label>
    <div class="shot-badges">
      <span class="badge shot-no-jp"${row.japanese ? " hidden" : ""}>no text</span>
      <span class="badge shot-no-en"${row.english ? " hidden" : ""}>no english</span>
      <span class="badge shot-done">saved</span>
    </div>
    <div class="shot-actions">
      <label class="shot-position">Show text
        <select class="shot-position-select" aria-label="Text position">
          <option value="0"${row.position === 1 ? "" : " selected"}>At the bottom</option>
          <option value="1"${row.position === 1 ? " selected" : ""}>At the top</option>
        </select>
      </label>
      <button class="pill ghost sm" type="button" data-shot-autofill>Autofill</button>
      <button class="pill dark sm" type="button" data-shot-save>Save</button>
      <button class="pill ghost rem sm" type="button" data-shot-delete>Delete</button>
    </div>
    <div class="shot-error" role="alert" hidden></div>
  </div>
</article>`;

const galleryCard = (row: Screenshot) => `<article class="shot-gallery-card">
  ${thumb(row, "shot-gallery-thumb")}
  <div class="shot-gallery-text">
    <div class="shot-jp">${esc(row.japanese) || `<span class="sub">No Japanese text</span>`}</div>
    ${row.english ? `<div class="shot-en">${esc(row.english)}</div>` : ""}
    <span class="badge">${row.done ? "saved" : "unfinished"}</span>
  </div>
</article>`;

export function screenshotViewerPage(id: number, back: string) {
  const row = getScreenshot(id);
  if (!row) return null;
  const theme = requestContext.getStore()?.theme ?? "light";
  const position = row.position === 1 ? "top" : "bottom";
  const body = `<div class="listhead"><div><h1>Screenshot</h1><p class="sub">${esc(row.japanese) || "No Japanese text"}</p></div><div class="shot-viewer-actions"><a class="pill ghost sm" href="${esc(back)}">Back</a><button class="pill dark sm" id="shot-viewer-edit" type="button">Edit</button><button class="pill ghost rem sm" id="shot-viewer-delete" type="button">Delete</button></div></div>
    <div class="shot-viewer-frame">
      <img src="${shotUrl(row.id)}" alt="Screenshot #${row.id}">
      <div class="shot-viewer-overlay ${position}" id="shot-viewer-overlay"${row.japanese ? "" : " hidden"}>
        <div class="shot-viewer-jp" id="shot-viewer-jp">${esc(row.japanese)}</div>
        <div class="shot-viewer-en" id="shot-viewer-en"${row.english ? "" : " hidden"}>${esc(row.english)}</div>
      </div>
    </div>
    <form class="card shot-edit-card" id="shot-edit-form" hidden>
      <div class="cardhead"><h2 class="h3">Edit screenshot</h2></div>
      <div class="shot-edit-fields">
        <label class="shot-label">Japanese
          <textarea id="shot-edit-jp" rows="4" spellcheck="false">${esc(row.japanese)}</textarea>
        </label>
        <label class="shot-label">English
          <textarea id="shot-edit-en" rows="3" spellcheck="false">${esc(row.english)}</textarea>
        </label>
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

  const result = listQueue(requested);
  const count = unfinishedCount();
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
      <div class="shot-queue-head"><h2>Queue</h2><div class="shot-queue-actions"><button class="pill ghost sm" id="autofill-empty" type="button" disabled>Autofill 0 empty</button><button class="pill dark sm" id="save-all" type="button">Save all</button></div></div>
      <div class="shot-ocr-line" id="shot-ocr-line">
        <span class="shot-ocr-dot checking"></span><span id="shot-ocr-text">Checking OCR…</span>
        <button class="pill ghost sm" id="shot-ocr-recheck" type="button">Recheck</button>
      </div>
      <div class="shot-queue" id="shot-queue">
        ${result.rows.length ? result.rows.map(queueCard).join("") : `<div class="card listempty"><h2>No pending screenshots</h2><p class="sub">Upload one above.</p></div>`}
      </div>
      ${pager(result.page, result.pages, (n) => `/screenshot?page=${n}`)}
    </section>
    <script src="/js/screenshot-page.js" defer type="module"></script>`;

  // Empty state sits outside the queue container so actions can remove cards
  // without removing the empty-state message.
  return html(layout("Screenshots – Kanji", body, { theme, back, active: "screenshots" }));
}
