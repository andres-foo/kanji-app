// Environment and paths, read once at startup.
export const PORT = Number(process.env.PORT ?? 3000);
export const DB_PATH = process.env.DB_PATH ?? "./data/kanji.db";
export const IMAGES_DIR = process.env.IMAGES_DIR ?? "./data/images";
