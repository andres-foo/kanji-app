import { db } from "./db";
import { envFileValue, writeEnvFileValue } from "./env-file";

const AI_KEY = "AI_API_KEY";

// The key lives in the local .env file, never in the tracked user database.
export const getAiKey = () => {
  const fromFile = envFileValue(AI_KEY).trim();
  if (fromFile) return fromFile;
  // Fallback for a legacy row only when the startup migration could not write
  // .env. A successful migration deletes that row.
  try {
    const row = db.query(`SELECT value FROM settings WHERE key = 'ai_api_key'`).get() as { value: string } | null;
    return String(row?.value ?? "").trim();
  } catch {
    return "";
  }
};

export const hasAiKey = () => getAiKey() !== "";

export function setAiKey(key: string): void {
  writeEnvFileValue(AI_KEY, key.trim());
  // Drop any legacy copy so the tracked DB never keeps a secret.
  try { db.run(`DELETE FROM settings WHERE key = 'ai_api_key'`); } catch {}
}

// Move a key saved by an earlier build out of user.db. If .env cannot be
// written, keep the row as a fallback rather than losing the key.
export function migrateLegacyAiKey(): void {
  try {
    const row = db.query(`SELECT value FROM settings WHERE key = 'ai_api_key'`).get() as { value: string } | null;
    if (!row) return;
    const legacy = String(row.value ?? "").trim();
    if (legacy && !envFileValue(AI_KEY).trim()) {
      try { writeEnvFileValue(AI_KEY, legacy); } catch { return; }
    }
    db.run(`DELETE FROM settings WHERE key = 'ai_api_key'`);
  } catch { /* settings table missing or not writable */ }
}
