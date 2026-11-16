// Environment and paths, read once at startup.
export const PORT = Number(process.env.PORT ?? 3000);
export const DB_PATH = process.env.DB_PATH ?? "./data/user.db";
export const REFERENCE_DB_PATH = process.env.REFERENCE_DB_PATH ?? "./data/reference.db";
export const PHRASE_DB_PATH = process.env.PHRASE_DB_PATH ?? "./data/phrases.db";
export const IMAGES_DIR = process.env.IMAGES_DIR ?? "./data/images";
export const ENV_FILE = process.env.ENV_FILE ?? "./.env";
export const SCREENSHOTS_DB_PATH = process.env.SCREENSHOTS_DB_PATH ?? "./data/screenshots.db";
export const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR ?? "./data/screenshots";
