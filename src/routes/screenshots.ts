import { sniffImage, MAX_IMAGE_BYTES } from "../images";
import { sameOrigin } from "../prefs";
import {
  addScreenshot,
  deleteScreenshot,
  getScreenshot,
  ocrStatus,
  readScreenshot,
  runOcr,
  saveScreenshot,
  serializedOcr,
  setJapanese,
  shotPath,
  shotUrl,
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
  let skipped = Math.max(0, selected.length - 5);
  let uploaded = 0;
  let duplicates = 0;
  let errors = 0;
  for (const file of selected.slice(0, 5)) {
    if (file.size > MAX_IMAGE_BYTES) { skipped++; continue; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (sniffImage(bytes) !== "jpg") { skipped++; continue; }
    try {
      const result = await addScreenshot(bytes);
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
  const row = getScreenshot(id);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  let force = false;
  try {
    const body = await req.json() as { force?: boolean };
    force = body.force === true;
  } catch { /* an empty body means normal autofill */ }
  if (row.japanese.trim() && !force) return json({ ok: true, skipped: true, text: row.japanese });
  return serializedOcr(async () => {
    const file = readScreenshot(row);
    if (!(await file.exists())) return json({ ok: false, error: "file missing" }, 404);
    const result = await runOcr(new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) return json({ ok: false, error: "offline" }, 502);
    if (!result.text) return json({ ok: true, text: "" });
    setJapanese(row.id, result.text);
    return json({ ok: true, text: result.text });
  });
}

export async function saveScreenshotRoute(req: Request, rawId: string | undefined) {
  if (!sameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  const id = idFrom(rawId);
  if (id === null) return json({ ok: false, error: "bad id" }, 400);
  let body: { japanese?: unknown; english?: unknown };
  try { body = await req.json() as typeof body; } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const japanese = String(body.japanese ?? "").trim();
  const english = String(body.english ?? "").trim();
  if (!japanese) return json({ ok: false, error: "japanese required" }, 400);
  const row = saveScreenshot(id, japanese, english);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  return json({ ok: true, row });
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
  return new Response(file, { headers: { "content-type": "image/jpeg", "cache-control": "no-cache" } });
}

export async function ocrStatusResponse() {
  return json(await ocrStatus());
}

export { shotUrl };
