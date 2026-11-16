import { getAiKey } from "./ai-key";
import { textSetting } from "./settings";

// One client for any OpenAI-compatible /chat/completions endpoint. The key
// lives in the settings table and is only ever read here: it is never sent to
// the browser, put in a URL, or logged.

export type AiError =
  | "disabled"
  | "unauthorized"
  | "rate-limited"
  | "timeout"
  | "offline"
  | "bad-response";

export type AiResult<T> = { ok: true; value: T } | { ok: false; error: AiError };

export type OcrResult = { japanese: string; english: string; confidence: number };
export type Analysis = string;

const TIMEOUT_MS = 30_000;
const CACHE_LIMIT = 200;

const analysisCache = new Map<string, string>();

// A burst of Autofill / Analyze clicks should queue behind one request instead
// of fanning out and burning quota. The old local OCR queue did the same.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export function aiConfigured(): boolean {
  return textSetting("ai_enabled") === "1" && getAiKey() !== "";
}

const isAbort = (error: unknown) => {
  const name = (error as { name?: string } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
};

async function request(
  messages: unknown[],
  opts: { json?: boolean; maxTokens?: number } = {},
  requireEnabled = true,
): Promise<AiResult<string>> {
  const key = getAiKey();
  if (!key) return { ok: false, error: "disabled" };
  if (requireEnabled && textSetting("ai_enabled") !== "1") return { ok: false, error: "disabled" };
  const base = textSetting("ai_base_url").trim().replace(/\/+$/, "");
  const model = textSetting("ai_model").trim();

  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, error: isAbort(error) ? "timeout" : "offline" };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return { ok: false, error: "unauthorized" };
    if (response.status === 429) return { ok: false, error: "rate-limited" };
    if (response.status >= 500) return { ok: false, error: "offline" };
    return { ok: false, error: "bad-response" };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    return { ok: false, error: isAbort(error) ? "timeout" : "bad-response" };
  }
  const content = (data as { choices?: { message?: { content?: unknown } }[] } | null)
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return { ok: false, error: "bad-response" };
  return { ok: true, value: content };
}

// Every public AI call is serialized through the same queue.
export async function chat(messages: unknown[], opts: { json?: boolean } = {}): Promise<AiResult<string>> {
  const result = await serialized(() => request(messages, { json: opts.json }));
  if (result.ok && !result.value.trim()) return { ok: false, error: "bad-response" };
  return result;
}

// The settings page pings with max_tokens: 1: a valid HTTP body means the key,
// base URL and model are accepted, even when the one-token reply is empty. It
// deliberately ignores ai_enabled so a saved key can be tested before the
// feature is switched on.
export async function testConnection(): Promise<AiResult<string>> {
  return serialized(() => request([{ role: "user", content: "ping" }], { maxTokens: 1 }, false));
}

// Models often wrap JSON in a fence even when asked not to. Only a leading
// fence is stripped; the closing one is removed with it when present.
const stripJsonFence = (value: string) => {
  const text = value.trim();
  if (!/^```(?:json)?\s*\r?\n?/i.test(text)) return text;
  return text.replace(/^```(?:json)?\s*\r?\n?/i, "").replace(/\r?\n?```$/, "").trim();
};

const OCR_SYSTEM = `You transcribe Japanese text from screenshots of video games and manga.
Transcribe exactly what is written, character for character.
- Include only dialogue, narration, and subtitles. Ignore menus, buttons, HUD labels, watermarks, and background text.
- Do not translate, correct, summarize, or normalize anything. Keep katakana as katakana. Do not add furigana. Preserve punctuation as printed.
- Keep the original line breaks between separate text lines.
- If the image contains no Japanese text, return "" for japanese.
Respond with JSON only, no prose:
{"japanese": string, "english": string, "confidence": number}`;

const ANALYSIS_SYSTEM = `You are a Japanese tutor for a learner who already knows kana and is studying kanji.
Given one or more Japanese sentences, reply in compact markdown with these sections:
**Reading** — the full text with kana reading in parentheses after each kanji.
**Grammar** — the sentence structure, one bullet per clause; name the particles and forms.
**Vocabulary** — a table of the content words: word | reading | meaning | part of speech.
**Notes** — register, nuance, or a common mistake to avoid.
Be concrete and brief. No filler, no praise, no repetition of the input.`;

const TRANSLATE_SYSTEM = `Translate the Japanese text into natural English.
Reply with only the translation, no notes, explanations, or quotation marks.`;

const imageMime = (bytes: Uint8Array) =>
  bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    ? "image/png"
    : "image/jpeg";

export async function describeImage(jpegOrPngBytes: Uint8Array): Promise<AiResult<OcrResult>> {
  const dataUrl = `data:${imageMime(jpegOrPngBytes)};base64,${Buffer.from(jpegOrPngBytes).toString("base64")}`;
  const result = await chat(
    [
      { role: "system", content: OCR_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe the Japanese text in this screenshot." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    { json: true },
  );
  if (!result.ok) return result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(result.value));
  } catch {
    return { ok: false, error: "bad-response" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "bad-response" };
  const { japanese, english, confidence } = parsed as Record<string, unknown>;
  if (typeof japanese !== "string" || typeof english !== "string" || typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return { ok: false, error: "bad-response" };
  }
  return {
    ok: true,
    value: {
      japanese: japanese.trim(),
      english: english.trim(),
      confidence: Math.max(0, Math.min(1, confidence)),
    },
  };
}

const stripMarkdownFence = (value: string) => {
  const text = value.trim();
  if (!/^```(?:markdown|md)?\s*\r?\n?/i.test(text)) return text;
  return text.replace(/^```(?:markdown|md)?\s*\r?\n?/i, "").replace(/\r?\n?```$/, "").trim();
};

export async function analyzeJapanese(text: string): Promise<AiResult<Analysis>> {
  if (!aiConfigured()) return { ok: false, error: "disabled" };
  const source = text.trim();
  if (!source) return { ok: false, error: "bad-response" };

  const cached = analysisCache.get(source);
  if (cached !== undefined) return { ok: true, value: cached };

  const result = await chat([
    { role: "system", content: ANALYSIS_SYSTEM },
    { role: "user", content: source },
  ]);
  if (!result.ok) return result;
  const value = stripMarkdownFence(result.value);
  if (!value) return { ok: false, error: "bad-response" };

  if (analysisCache.size >= CACHE_LIMIT) analysisCache.clear();
  analysisCache.set(source, value);
  return { ok: true, value };
}

// Translate follows the same optional backend: with no key the route keeps
// using the free Google path in translate.ts.
export async function translateJapanese(text: string): Promise<AiResult<string>> {
  const source = text.trim();
  if (!source) return { ok: false, error: "bad-response" };
  return chat([
    { role: "system", content: TRANSLATE_SYSTEM },
    { role: "user", content: source },
  ]);
}
