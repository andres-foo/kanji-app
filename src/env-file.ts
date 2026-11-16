import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ENV_FILE } from "./config";

// Small reader/writer for the local .env file. The AI key is the only value
// changed here; every other line (IMPORT_TOKEN, comments, blanks) is preserved.

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

const parseValue = (raw: string) => {
  const text = raw.trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text.replace(/\s+#.*$/, "").trim();
};

export function readEnvFile(path = ENV_FILE): Record<string, string> {
  if (!existsSync(path)) return {};
  const source = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const values: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = ENV_LINE.exec(line);
    if (match) values[match[1]] = parseValue(match[2]);
  }
  return values;
}

// Reads return "" when the file is missing; a permissions problem should only
// make the feature look disabled, not break page rendering.
export function envFileValue(key: string, path = ENV_FILE): string {
  try {
    return readEnvFile(path)[key] ?? "";
  } catch {
    return "";
  }
}

export function writeEnvFileValue(key: string, value: string, path = ENV_FILE): void {
  const next = value.trim();
  const exists = existsSync(path);
  const lines = exists ? readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/) : [];
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  const out: string[] = [];
  let found = false;
  for (const line of lines) {
    const match = ENV_LINE.exec(line);
    if (match && match[1] === key) {
      // Keep the first occurrence at its original position; drop duplicates.
      if (!found && next !== "") out.push(`${key}=${next}`);
      found = true;
      continue;
    }
    out.push(line);
  }
  if (!found && next !== "") out.push(`${key}=${next}`);
  if (!exists && !out.length) return;

  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const content = out.length ? `${out.join("\n")}\n` : "";
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    // 0600 where the platform supports it; a temp file plus rename avoids
    // leaving a half-written .env if the process dies mid-save.
    writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
    try {
      renameSync(tmp, path);
    } catch {
      try { unlinkSync(tmp); } catch {}
      writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
    }
  } catch (error) {
    try { unlinkSync(tmp); } catch {}
    throw error;
  }
}
