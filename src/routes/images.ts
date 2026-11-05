import { imagePath, kanjiExists, MAX_IMAGE_BYTES, removeImages, sniffImage } from "../images";
import { enc } from "../html";
import { sameOrigin, safeBack } from "../prefs";
import { messagePage } from "../views/message";

const imageError = (msg: string, status: number, literal: string) =>
  messagePage("Image error", msg, status, { href: `/kanji/${enc(literal)}?edit=1`, label: "Back to kanji" });

// replace the kanji's image with an uploaded jpg/png and make sure no file of the other format remains
export async function uploadImage(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  if (!kanjiExists(literal)) return messagePage("Kanji not found", `“${literal}” is not in the database.`, 404);
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return imageError("No image was selected.", 400, literal);
  if (file.size > MAX_IMAGE_BYTES) return imageError(`The image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`, 413, literal);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) return imageError("Only JPEG and PNG images are supported.", 415, literal);
  try {
    await Bun.write(imagePath(literal, ext), bytes);
  } catch (e) {
    return imageError(`Could not save the image: ${(e as Error).message}. Is the images folder writable?`, 500, literal);
  }
  const problem = await removeImages(literal, ext);
  if (problem) return imageError(problem, 500, literal);
  return new Response(null, { status: 303, headers: { location: back } });
}

// delete the kanji's image (every format) and verify it is gone
export async function deleteImage(req: Request, literal: string) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  if (!kanjiExists(literal)) return messagePage("Kanji not found", `“${literal}” is not in the database.`, 404);
  const form = await req.formData();
  const back = safeBack(form.get("back"));
  const problem = await removeImages(literal);
  if (problem) return imageError(problem, 500, literal);
  return new Response(null, { status: 303, headers: { location: back } });
}
