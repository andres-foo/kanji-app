import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { likeEsc } from "./html";
import { OCR_URL, SCREENSHOTS_DIR } from "./config";
import { shots } from "./screenshots-db";

export const PER_PAGE = 12;
export const THUMBS_DIR = join(SCREENSHOTS_DIR, "thumbs");
mkdirSync(THUMBS_DIR, { recursive: true });

export type Screenshot = {
  id: number;
  file: string;
  hash: string;
  japanese: string;
  english: string;
  added_at: string;
  done: number;
  position: number;
};

export const shotPath = (file: string) => join(SCREENSHOTS_DIR, file);
export const shotThumbPath = (file: string) => join(THUMBS_DIR, file);
export const hashBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const shotUrl = (id: number, hash: string) => `/shot/${id}?v=${encodeURIComponent(hash)}`;
export const shotThumbUrl = (id: number, hash: string) => `/shot/${id}/thumb?v=${encodeURIComponent(hash)}`;

export const getScreenshot = (id: number) =>
  shots.query(`SELECT * FROM screenshots WHERE id = ?`).get(id) as Screenshot | null;

export const readScreenshot = (row: Screenshot) => Bun.file(shotPath(row.file));

export async function addScreenshot(bytes: Uint8Array, thumbBytes?: Uint8Array) {
  const hash = hashBytes(bytes);
  const existing = shots.query(`SELECT file FROM screenshots WHERE hash = ?`).get(hash) as { file: string } | null;
  if (existing) {
    if (thumbBytes && !(await Bun.file(shotThumbPath(existing.file)).exists())) {
      await Bun.write(shotThumbPath(existing.file), thumbBytes);
    }
    return { duplicate: true as const };
  }
  const file = `${hash}.jpg`;
  await Bun.write(shotPath(file), bytes);
  if (thumbBytes) await Bun.write(shotThumbPath(file), thumbBytes);
  try {
    const result = shots.run(
      `INSERT INTO screenshots (file, hash) VALUES (?, ?)`,
      [file, hash],
    );
    return { duplicate: false as const, id: Number(result.lastInsertRowid) };
  } catch (error) {
    try { await unlink(shotPath(file)); } catch {}
    try { await unlink(shotThumbPath(file)); } catch {}
    throw error;
  }
}

export const unfinishedCount = () =>
  (shots.query(`SELECT COUNT(*) AS n FROM screenshots WHERE done = 0`).get() as { n: number }).n;

export function listQueue(page: number) {
  const total = unfinishedCount();
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const current = Math.min(pages, Math.max(1, page));
  const rows = shots.query(`SELECT * FROM screenshots WHERE done = 0 ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(PER_PAGE, (current - 1) * PER_PAGE) as Screenshot[];
  return { rows, total, pages, page: current };
}

export const kanjiScreenshotCount = (literal: string) =>
  (shots.query(`SELECT COUNT(*) AS n FROM screenshots WHERE done = 1 AND japanese LIKE ? ESCAPE '\\'`)
    .get(`%${likeEsc(literal)}%`) as { n: number }).n;

export const kanjiScreenshots = (literal: string, limit = 6) =>
  shots.query(`SELECT * FROM screenshots
    WHERE done = 1 AND japanese LIKE ? ESCAPE '\\'
    ORDER BY added_at DESC, id DESC LIMIT ?`)
    .all(`%${likeEsc(literal)}%`, limit) as Screenshot[];

export function listForKanji(literal: string, page: number) {
  const total = (shots.query(`SELECT COUNT(*) AS n FROM screenshots
    WHERE japanese LIKE ? ESCAPE '\\'`).get(`%${likeEsc(literal)}%`) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const current = Math.min(pages, Math.max(1, page));
  const rows = shots.query(`SELECT * FROM screenshots
    WHERE japanese LIKE ? ESCAPE '\\'
    ORDER BY added_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(`%${likeEsc(literal)}%`, PER_PAGE, (current - 1) * PER_PAGE) as Screenshot[];
  return { rows, total, pages, page: current };
}

export function saveScreenshot(id: number, japanese: string, english: string, position = 0) {
  shots.run(`UPDATE screenshots SET japanese = ?, english = ?, position = ?, done = 1 WHERE id = ?`, [japanese, english, position, id]);
  return getScreenshot(id);
}

export function setJapanese(id: number, japanese: string) {
  shots.run(`UPDATE screenshots SET japanese = ? WHERE id = ?`, [japanese, id]);
  return getScreenshot(id);
}

export async function deleteScreenshot(row: Screenshot) {
  shots.run(`DELETE FROM screenshots WHERE id = ?`, [row.id]);
  for (const path of [shotPath(row.file), shotThumbPath(row.file)]) {
    try { await unlink(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

// OCR calls are serialized so a burst of per-card autofill clicks cannot
// overload the external service.
let ocrQueue: Promise<unknown> = Promise.resolve();
export function serializedOcr<T>(fn: () => Promise<T>): Promise<T> {
  const run = ocrQueue.then(fn, fn);
  ocrQueue = run.catch(() => {});
  return run;
}

export async function ocrStatus(): Promise<{ state: "ready" | "loading" | "offline"; model?: string }> {
  try {
    const response = await fetch(`${OCR_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return { state: "offline" };
    const data = await response.json() as { ready?: boolean; model?: string };
    if (!data.ready) return { state: "loading", model: data.model };
    return { state: "ready", model: data.model };
  } catch {
    return { state: "offline" };
  }
}

export async function runOcr(bytes: Uint8Array): Promise<{ ok: true; text: string } | { ok: false; error: "offline" }> {
  try {
    const response = await fetch(`${OCR_URL}/ocr`, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: bytes,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return { ok: false, error: "offline" };
    const data = await response.json() as { ok?: boolean; lines?: { text?: string }[] };
    if (!data.ok) return { ok: false, error: "offline" };
    const text = (data.lines ?? []).map((line) => String(line.text ?? "")).filter(Boolean).join("\n");
    return { ok: true, text };
  } catch {
    return { ok: false, error: "offline" };
  }
}
