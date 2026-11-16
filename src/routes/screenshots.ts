import { aiConfigured, analyzeJapanese, describeImage, translateJapanese } from "../ai";
import { sniffImage, MAX_IMAGE_BYTES } from "../images";
import { markdownHtml } from "../markdown";
import { sameOrigin } from "../prefs";
import { translateToEnglish } from "../translate";
import {
  addScreenshot,
  deleteScreenshot,
  getScreenshot,
  readScreenshot,
  saveScreenshot,
  setScreenshotAnalysis,
  setScreenshotPosition,
  setScreenshotText,
  shotPath,
  shotThumbPath
} from "../screenshots";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const idFrom = (value: string | undefined) => {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
};

export async function uploadScreenshots(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response(null, { status: 303, headers: { location: "/screenshot?uploadError=Could not read the upload." } });
  }
  const selected = form.getAll("files").filter((file): file is File => file instanceof File && file.size > 0);
  const thumbFiles = form.getAll("thumbs").filter((file): file is File => file instanceof File && file.size > 0);
  let skipped = Math.max(0, selected.length - 5);
  let uploaded = 0;
  let duplicates = 0;
  let errors = 0;
  for (const [index, file] of selected.slice(0, 5).entries()) {
    if (file.size > MAX_IMAGE_BYTES) { skipped++; continue; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (sniffImage(bytes) !== "jpg") { skipped++; continue; }
    const thumbFile = thumbFiles[index];
    const thumbBytes = thumbFile && thumbFile.size <= MAX_IMAGE_BYTES ? new Uint8Array(await thumbFile.arrayBuffer()) : undefined;
    try {
      const result = await addScreenshot(bytes, thumbBytes && sniffImage(thumbBytes) === "jpg" ? thumbBytes : undefined);
      if (result.duplicate) duplicates++;
      else uploaded++;
    } catch {
      errors++;
    }
  }
  const params = new URLSearchParams({ uploaded: String(uploaded), duplicates: String(duplicates), skipped: String(skipped), errors: String(errors) });
  return new Response(null, { status: 303, headers: { location: `/screenshot?${params}` } });
}

export async function autofillScreenshot(req: Request, rawId: string | undefined) {
  if (!sameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  const id = idFrom(rawId);
  if (id === null) return json({ ok: false, error: "bad id" }, 400);
  if (!aiConfigured()) return json({ ok: false, error: "disabled" });
  const row = getScreenshot(id);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  let force = false;
  try {
    const body = await req.json() as { force?: boolean };
    force = body.force === true;
  } catch { /* an empty body means normal autofill */ }
  // The editor confirms before overwriting visible Japanese, then sends force.
  // Without it, return the stored text instead of paying for another call.
  if (row.japanese.trim() && !force) {
    return json({ ok: true, japanese: row.japanese, english: row.english });
  }

  const file = readScreenshot(row);
  if (!(await file.exists())) return json({ ok: false, error: "not found" }, 404);
  const result = await describeImage(new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) return json({ ok: false, error: result.error });

  // Low confidence still fills the field, with a visible warning the user has
  // to delete (or decide to keep) before saving.
  const japanese = result.value.confidence < 0.5
    ? `${result.value.japanese}${result.value.japanese ? "\n" : ""}⚠ low confidence`
    : result.value.japanese;
  const english = row.english.trim() ? row.english : result.value.english;
  setScreenshotText(row.id, japanese, english);
  return json({ ok: true, japanese, english });
}

// Analyze runs on the stored Japanese text only; the image never leaves the
// machine for this call. The markdown is persisted so it survives a reload.
export async function analyzeScreenshot(req: Request, rawId: string | undefined) {
  if (!sameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  const id = idFrom(rawId);
  if (id === null) return json({ ok: false, error: "bad id" }, 400);
  if (!aiConfigured()) return json({ ok: false, error: "disabled" });
  const row = getScreenshot(id);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  if (!row.japanese.trim()) return json({ ok: false, error: "no-text" });

  const result = await analyzeJapanese(row.japanese);
  if (!result.ok) return json({ ok: false, error: result.error });
  setScreenshotAnalysis(row.id, result.value);
  return json({ ok: true, analysis: result.value, analysis_html: markdownHtml(result.value) });
}

export async function saveScreenshotRoute(req: Request, rawId: string | undefined) {
  if (!sameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  const id = idFrom(rawId);
  if (id === null) return json({ ok: false, error: "bad id" }, 400);
  let body: { japanese?: unknown; english?: unknown; position?: unknown };
  try { body = await req.json() as typeof body; } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const japanese = String(body.japanese ?? "").trim();
  const english = String(body.english ?? "").trim();
  const position = Number(body.position) === 1 ? 1 : 0;
  if (!japanese) return json({ ok: false, error: "japanese required" }, 400);
  const existing = getScreenshot(id);
  if (!existing) return json({ ok: false, error: "not found" }, 404);
  // Imported furigana describes the imported sentence. Keep it when the text
  // is unchanged; a different sentence invalidates it.
  const furigana = existing.japanese === japanese ? existing.japanese_furigana : "";
  const row = saveScreenshot(id, japanese, english, position, furigana);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  return json({ ok: true, row });
}

// Position-only autosave from the editor; it must not mark the row as saved.
export async function saveScreenshotPosition(req: Request, rawId: string | undefined) {
  if (!sameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  const id = idFrom(rawId);
  if (id === null) return json({ ok: false, error: "bad id" }, 400);
  let body: { position?: unknown };
  try { body = await req.json() as typeof body; } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const position = Number(body.position);
  if (position !== 0 && position !== 1) return json({ ok: false, error: "invalid position" }, 400);
  const row = setScreenshotPosition(id, position);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  return json({ ok: true, position });
}

export async function deleteScreenshotRoute(req: Request, rawId: string | undefined) {
  if (!sameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  const id = idFrom(rawId);
  if (id === null) return json({ ok: false, error: "bad id" }, 400);
  const row = getScreenshot(id);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  try {
    await deleteScreenshot(row);
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: String((error as Error).message ?? error) }, 500);
  }
}

export async function serveScreenshot(rawId: string | undefined) {
  const id = idFrom(rawId);
  if (id === null) return new Response("Not found", { status: 404 });
  const row = getScreenshot(id);
  if (!row) return new Response("Not found", { status: 404 });
  const file = Bun.file(shotPath(row.file));
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}

export async function serveScreenshotThumb(rawId: string | undefined) {
  const id = idFrom(rawId);
  if (id === null) return new Response("Not found", { status: 404 });
  const row = getScreenshot(id);
  if (!row) return new Response("Not found", { status: 404 });
  let file = Bun.file(shotThumbPath(row.file));
  if (!(await file.exists())) {
    file = Bun.file(shotPath(row.file));
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
  }
  return new Response(file, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}

// Japanese → English for the screenshot editors. When an AI key is configured
// the provider translates; with no key this stays on Google's free endpoint,
// which never sees images or database rows.
export async function translateScreenshotText(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  let body: { text?: unknown };
  try { body = await req.json() as typeof body; } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const text = String(body.text ?? "").trim();
  if (!text) return json({ ok: false, error: "empty" }, 400);
  if (aiConfigured()) {
    const result = await translateJapanese(text.slice(0, 4000));
    if (!result.ok) return json({ ok: false, error: result.error, ai: true });
    return json({ ok: true, text: result.value, ai: true });
  }
  const result = await translateToEnglish(text.slice(0, 4000));
  if (!result.ok) return json({ ok: false, error: result.error }, 502);
  return json({ ok: true, text: result.text });
}
