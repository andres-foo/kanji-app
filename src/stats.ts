export const STAT_RANGES = [30, 90, 180] as const;

// date arithmetic on plain YYYY-MM-DD strings (no timezone involved)
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// too hard / about right / too easy, from the share of answers that were not bad at a level
export function verdict(total: number, okPct: number): { text: string; cls: string } {
  if (total < 30) return { text: "Not enough data", cls: "none" };
  if (okPct < 80) return { text: "Too hard", cls: "hard" };
  if (okPct > 95) return { text: "Too easy", cls: "easy" };
  return { text: "About right", cls: "ok" };
}
