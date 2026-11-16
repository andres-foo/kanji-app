import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_IMAGE_BYTES, sniffImage } from "../images";
import { addImportedScreenshot } from "../screenshots";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const MAX_TEXT = 2000;
const MAX_FURIGANA = 4000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const digest = (value: string) => createHash("sha256").update(value).digest();

// Comparing digests of both values keeps the check constant-time and avoids the
// length check timingSafeEqual would otherwise leak through its throw.
const tokenMatches = (received: string | null, expected: string) =>
  received !== null && timingSafeEqual(digest(received), digest(expected));

// Standard base64, or null. Whitespace is ignored so line-wrapped base64 from
// older clients still decodes, but a data: prefix or any other junk does not.
const decodeBase64 = (value: unknown): Uint8Array | null => {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !BASE64.test(compact)) return null;
  try {
    const binary = atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

const isJpeg = (bytes: Uint8Array) => bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES && sniffImage(bytes) === "jpg";

// Server-to-server import for an external app that already ran OCR and
// translation. It has no Origin header, so sameOrigin() would let the whole LAN
// in — the shared secret is the only gate. Unset IMPORT_TOKEN disables it.
export async function importScreenshot(req: Request) {
  const expected = (process.env.IMPORT_TOKEN ?? "").trim();
  if (!expected) return json({ ok: false, error: "import disabled" }, 503);
  if (!tokenMatches(req.headers.get("x-import-token"), expected)) return json({ ok: false, error: "bad token" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "invalid json" }, 400);
  const input = body as Record<string, unknown>;

  if (typeof input.japanese !== "string" || !input.japanese.trim()) return json({ ok: false, error: "japanese required" }, 400);
  const japanese = input.japanese.trim();
  if (japanese.length > MAX_TEXT) return json({ ok: false, error: "japanese too long" }, 400);

  let english = "";
  if (input.english !== undefined && input.english !== null) {
    if (typeof input.english !== "string") return json({ ok: false, error: "invalid json" }, 400);
    english = input.english.trim();
    if (english.length > MAX_TEXT) return json({ ok: false, error: "english too long" }, 400);
  }

  let furigana = "";
  if (input.japanese_furigana !== undefined && input.japanese_furigana !== null) {
    if (typeof input.japanese_furigana !== "string") return json({ ok: false, error: "invalid furigana" }, 400);
    furigana = input.japanese_furigana.trim();
    if (furigana.length > MAX_FURIGANA) return json({ ok: false, error: "furigana too long" }, 400);
  }

  const image = decodeBase64(input.image);
  if (!image) return json({ ok: false, error: "invalid image" }, 400);
  if (image.length > MAX_IMAGE_BYTES) return json({ ok: false, error: "image too large" }, 413);
  if (sniffImage(image) !== "jpg") return json({ ok: false, error: "image must be jpeg" }, 415);

  let thumbBytes: Uint8Array | undefined;
  if (input.thumb !== undefined && input.thumb !== null) {
    const thumb = decodeBase64(input.thumb);
    if (!thumb || !isJpeg(thumb)) return json({ ok: false, error: "invalid thumb" }, 400);
    thumbBytes = thumb;
  }

  // Markdown goes in as-is; anything structured is kept as JSON text.
  let analysis: string | undefined;
  if (input.analysis !== undefined && input.analysis !== null) {
    analysis = typeof input.analysis === "string" ? input.analysis : JSON.stringify(input.analysis);
  }

  try {
    const result = await addImportedScreenshot(image, {
      japanese,
      english,
      furigana,
      thumbBytes,
      analysis,
      position: Number(input.position) === 1 ? 1 : 0,
      overwrite: input.overwrite === true,
    });
    return json({ ok: true, id: result.id, duplicate: result.duplicate });
  } catch (error) {
    console.error("screenshot import failed:", error);
    return json({ ok: false, error: "import failed" }, 500);
  }
}
