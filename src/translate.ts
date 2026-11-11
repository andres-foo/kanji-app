// Free Japanese → English translation through Google's public web endpoint.
// This is the same service translate.google.com uses, not an official API:
// there is no key and no SLA, so rate limits and outages are reported as
// "offline" and the caller keeps working without translation.
const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_CHUNK = 400;
const TIMEOUT_MS = 8000;
const CACHE_LIMIT = 200;

export type TranslationResult =
  | { ok: true; text: string }
  | { ok: false; error: "offline" | "rejected" };

const cache = new Map<string, string>();

// Response shape: [[["translated","source",null,null,10], ...], null, "ja", ...]
export const parseTranslation = (data: unknown): string => {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return "";
  return (data[0] as unknown[])
    .map((segment) => (Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : ""))
    .join("")
    .trim();
};

// Screenshot text is short, but keep each request URL small: Google gets the
// source text in the query string, so long lines are split at MAX_CHUNK.
export const chunkText = (text: string): string[] => {
  const chunks: string[] = [];
  let current = "";
  const flush = () => { if (current) { chunks.push(current); current = ""; } };
  for (const line of text.split("\n")) {
    if (line.length > MAX_CHUNK) {
      flush();
      for (let start = 0; start < line.length; start += MAX_CHUNK) chunks.push(line.slice(start, start + MAX_CHUNK));
      continue;
    }
    const next = current ? `${current}\n${line}` : line;
    if (next.length > MAX_CHUNK) { flush(); current = line; } else current = next;
  }
  flush();
  return chunks;
};

async function translateChunk(chunk: string): Promise<string | null> {
  const params = new URLSearchParams({ client: "gtx", sl: "ja", tl: "en", dt: "t", q: chunk });
  try {
    const response = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    return parseTranslation(await response.json());
  } catch {
    return null;
  }
}

export async function translateToEnglish(text: string): Promise<TranslationResult> {
  const source = text.trim();
  if (!source) return { ok: false, error: "rejected" };
  const cached = cache.get(source);
  if (cached !== undefined) return { ok: true, text: cached };

  const translated: string[] = [];
  for (const chunk of chunkText(source)) {
    const result = await translateChunk(chunk);
    if (result === null) return { ok: false, error: "offline" };
    translated.push(result);
  }

  const output = translated.join("\n").trim();
  if (!output) return { ok: false, error: "rejected" };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(source, output);
  return { ok: true, text: output };
}
