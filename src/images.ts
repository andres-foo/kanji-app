import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { IMAGES_DIR } from "./config";
import { db } from "./db";

export const IMAGE_EXTS = ["jpg", "png"] as const;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const imagePath = (literal: string, ext: string) => join(IMAGES_DIR, `${literal}.${ext}`);

export const imageExtsOnDisk = async (literal: string) => {
  const found: string[] = [];
  for (const ext of IMAGE_EXTS) if (await Bun.file(imagePath(literal, ext)).exists()) found.push(ext);
  return found;
};

// delete every image of the kanji except the format being kept, then verify nothing else is left;
// returns an error message or null
export async function removeImages(literal: string, keep?: string): Promise<string | null> {
  for (const ext of IMAGE_EXTS) {
    if (ext === keep) continue;
    try { await unlink(imagePath(literal, ext)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") return `Could not delete ${literal}.${ext}: ${(e as Error).message}`; }
  }
  const left = (await imageExtsOnDisk(literal)).filter((ext) => ext !== keep);
  return left.length ? `Old image files are still present for ${literal}: ${left.map((e) => `${literal}.${e}`).join(", ")}.` : null;
}

export const sniffImage = (b: Uint8Array): "png" | "jpg" | null =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a ? "png"
    : b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg" : null;

export const kanjiExists = (literal: string) =>
  [...literal].length === 1 && !!db.query(`SELECT 1 FROM kanjis WHERE literal = ?`).get(literal);

// the kanji's image file in IMAGES_DIR, if one exists (jpg is tried first)
export async function findImage(literal: string) {
  if ([...literal].length !== 1) return null;
  for (const ext of IMAGE_EXTS) {
    const f = Bun.file(imagePath(literal, ext));
    if (await f.exists()) return f;
  }
  return null;
}
