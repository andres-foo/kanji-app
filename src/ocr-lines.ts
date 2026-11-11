// The OCR service answers with one box per detected text fragment, and it can
// split one visual line into several fragments (see the kanji-app-ocr docs).
// The editor wants one continuous line, so fragments are read top-left to
// bottom-right: fragments share a row when their vertical spans overlap by at
// least half of the shorter box and they sit within a line-height of each
// other horizontally, rows run top to bottom, and everything is joined without
// separators. Lines without a usable box keep their given order instead of
// guessing.
export type OcrLine = { text?: string; box?: number[] };

type Fragment = { text: string; x1: number; y1: number; x2: number; y2: number };
type Row = { y1: number; y2: number; items: Fragment[] };

const toFragment = (line: OcrLine): Fragment | null => {
  const text = String(line.text ?? "").trim();
  if (!text || !Array.isArray(line.box) || line.box.length !== 4) return null;
  const [x1, y1, x2, y2] = line.box.map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) return null;
  return { text, x1, y1, x2, y2 };
};

const sameRow = (row: Row, item: Fragment): boolean => {
  const overlap = Math.min(row.y2, item.y2) - Math.max(row.y1, item.y1);
  const height = Math.min(row.y2 - row.y1, item.y2 - item.y1);
  if (height <= 0 || overlap < height * 0.5) return false;
  return row.items.some((other) => {
    const gap = Math.max(other.x1, item.x1) - Math.min(other.x2, item.x2);
    return gap <= Math.min(other.y2 - other.y1, item.y2 - item.y1) * 0.8;
  });
};

export function joinOcrText(lines: OcrLine[]): string {
  const entries = lines
    .map((line) => ({ text: String(line.text ?? "").trim(), box: line.box }))
    .filter((entry) => entry.text);
  const fragments = entries.map(toFragment);
  if (fragments.some((fragment) => fragment === null)) return entries.map((entry) => entry.text).join("");

  const rows: Row[] = [];
  for (const item of (fragments as Fragment[]).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1)) {
    const row = rows.find((candidate) => sameRow(candidate, item));
    if (row) {
      row.items.push(item);
      row.y1 = Math.min(row.y1, item.y1);
      row.y2 = Math.max(row.y2, item.y2);
    } else {
      rows.push({ y1: item.y1, y2: item.y2, items: [item] });
    }
  }
  return rows
    .map((row) => row.items.sort((a, b) => a.x1 - b.x1).map((item) => item.text).join(""))
    .join("");
}
