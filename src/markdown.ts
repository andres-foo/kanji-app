import { esc } from "./html";

// Analyses arrive from the import endpoint as markdown and are shown read-only
// next to their screenshot. Every piece of input is escaped before any markup is
// added, so stored analysis text can never inject HTML or script.

// Only absolute web links become anchors; anything else (javascript:, relative
// paths, data:) is left as plain label text.
const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

// Inline markup: `code`, [label](url), **bold**, *italic*, _italic_, ~~strike~~.
function inline(text: string): string {
  let out = esc(text);

  // Code spans come first and are parked behind placeholders so their contents
  // are never touched by the emphasis rules.
  const code: string[] = [];
  out = out.replace(/`([^`\n]+)`/g, (_, content: string) => {
    code.push(`<code>${content}</code>`);
    return `\u0000${code.length - 1}\u0000`;
  });

  out = out
    .replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (_, label: string, href: string) => {
      const target = href.trim();
      return SAFE_LINK.test(target)
        ? `<a href="${esc(target)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?)\]])/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  return out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => code[Number(index)]);
}

type List = { ordered: boolean; items: string[] };

type Alignment = "left" | "center" | "right" | null;
type Table = { header: string[]; align: Alignment[]; rows: string[][] };

const TABLE_SEPARATOR = /^:?-{3,}:?$/;
const PIPE = "\u0001";

// Split a GFM-style row, with or without the outer pipes. Escaped pipes are
// parked behind a placeholder so a cell can contain a literal "|".
const splitTableRow = (line: string): string[] => {
  let text = line.trim().replace(/\\\|/g, PIPE);
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|").map((cell) => cell.trim().replace(/\u0001/g, "|"));
};

const alignmentOf = (cell: string): Alignment => {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : left ? "left" : right ? "right" : null;
};

// A table starts with a header row followed by a separator row whose cells are
// only dashes and optional alignment colons. Body rows run until a blank line
// or a line without a pipe.
const tableAt = (lines: string[], start: number): { table: Table; next: number } | null => {
  const headerLine = lines[start]?.trim() ?? "";
  const separatorLine = lines[start + 1]?.trim() ?? "";
  if (!headerLine.includes("|") || !separatorLine.includes("|")) return null;
  const header = splitTableRow(headerLine);
  const separator = splitTableRow(separatorLine);
  if (!separator.length || header.length !== separator.length) return null;
  if (!separator.every((cell) => TABLE_SEPARATOR.test(cell))) return null;

  const rows: string[][] = [];
  let next = start + 2;
  for (; next < lines.length; next++) {
    const line = lines[next].trim();
    if (!line || !line.includes("|")) break;
    const cells = splitTableRow(line);
    rows.push(header.map((_, index) => cells[index] ?? ""));
  }
  return { table: { header, align: separator.map(alignmentOf), rows }, next };
};

const tableHtml = ({ header, align, rows }: Table) => {
  const renderRow = (tag: "th" | "td", cells: string[]) =>
    `<tr>${cells.map((cell, index) => {
      const alignment = align[index];
      return `<${tag}${alignment ? ` style="text-align:${alignment}"` : ""}>${inline(cell)}</${tag}>`;
    }).join("")}</tr>`;
  return `<div class="markdown-table"><table><thead>${renderRow("th", header)}</thead><tbody>${rows.map((row) => renderRow("td", row)).join("")}</tbody></table></div>`;
};

// Block markup: headings, tables, fenced code, lists, block quotes, rules and
// paragraphs. Lines inside a paragraph keep their hard breaks.
export function markdownHtml(source: string): string {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: List | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    out.push(`<${tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${quote.map(inline).join("<br>")}</blockquote>`);
    quote = [];
  };
  const flush = () => { flushParagraph(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith("```")) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) body.push(lines[i]);
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (!trimmed) { flush(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flush(); out.push("<hr>"); continue; }

    const table = tableAt(lines, i);
    if (table) {
      flush();
      out.push(tableHtml(table.table));
      i = table.next - 1;
      continue;
    }

    const quoted = /^>\s?(.*)$/.exec(trimmed);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  flush();
  return out.join("\n");
}
