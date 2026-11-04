import { esc } from "../html";

export const BLUES = ["#dbe7f8", "#b5cff2", "#8fb7ec", "#5f9ae0", "#2a78d6", "#1f5fb5", "#184d94", "#0d2c57"]; // one hue, light to dark: the levels are ordered
const SVG_W = 720;
const SVG_H = 300;
const PAD = { l: 46, r: 14, t: 12, b: 30 };
const r1 = (x: number) => Math.round(x * 10) / 10;

// a "nice" step so that four steps cover the largest value
function axisStep(v: number): number {
  for (let p = 1; ; p *= 10) for (const m of [1, 2, 5]) if (4 * m * p >= v) return m * p;
}

function yAxis(ymax: number, step: number): string {
  let out = "";
  for (let v = 0; v <= ymax; v += step) {
    const y = r1(PAD.t + (SVG_H - PAD.t - PAD.b) * (1 - v / ymax));
    out += `<line class="${v === 0 ? "ax" : "gl"}" x1="${PAD.l}" x2="${SVG_W - PAD.r}" y1="${y}" y2="${y}"/><text x="${PAD.l - 8}" y="${y + 4}" text-anchor="end">${v}</text>`;
  }
  return out;
}

// stacked area chart; series are stacked from the first (bottom) to the last
export function areaChart(days: string[], series: { label: string; color: string; values: number[] }[], description: string): string {
  const n = days.length;
  const plotW = SVG_W - PAD.l - PAD.r;
  const plotH = SVG_H - PAD.t - PAD.b;
  const totals = days.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const step = axisStep(Math.max(...totals, 1));
  const ymax = step * 4;
  const x = (i: number) => r1(PAD.l + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1)));
  const y = (v: number) => r1(PAD.t + plotH * (1 - v / ymax));
  const cum = days.map(() => 0);
  const areas = series.map((s) => {
    const lower = [...cum];
    s.values.forEach((v, i) => (cum[i] += v));
    const top = cum.map((v, i) => `${x(i)},${y(v)}`);
    const bottom = lower.map((v, i) => `${x(i)},${y(v)}`).reverse();
    return `<path d="M${top.join("L")}L${bottom.join("L")}Z" fill="${s.color}"/>`;
  });
  const slot = plotW / n;
  const hover = days.map((d, i) => `<rect x="${r1(PAD.l + i * slot)}" y="${PAD.t}" width="${r1(slot)}" height="${plotH}" fill="transparent"><title>${esc(d)}: ${series.map((s) => `${esc(s.label)} ${s.values[i]}`).join(", ")}</title></rect>`).join("");
  const count = Math.min(6, n);
  const ticks = Array.from({ length: count }, (_, j) => (count === 1 ? 0 : Math.round((j * (n - 1)) / (count - 1))));
  const xlabels = [...new Set(ticks)].map((i) => `<text x="${x(i)}" y="${SVG_H - 8}" text-anchor="middle">${esc(days[i].slice(5))}</text>`).join("");
  return `<svg class="sv" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="${esc(description)}"><title>${esc(description)}</title>${yAxis(ymax, step)}${areas.join("")}${xlabels}${hover}</svg>`;
}

// stacked vertical bars: every bar is a list of segments drawn from the bottom up, so one column can show
// parts of a whole (the due queue) next to single-colour columns (the days to come)
export function barChart(labels: string[], bars: { value: number; color: string }[][], titles: string[], description: string): string {
  const n = labels.length;
  const plotW = SVG_W - PAD.l - PAD.r;
  const plotH = SVG_H - PAD.t - PAD.b;
  const totals = bars.map((bar) => bar.reduce((a, s) => a + s.value, 0));
  const step = axisStep(Math.max(...totals, 1));
  const ymax = step * 4;
  const slot = plotW / n;
  const bw = Math.min(24, slot * 0.7);
  const drawn = bars.map((bar, i) => {
    const bx = r1(PAD.l + i * slot + (slot - bw) / 2);
    const top = bar.map((s) => s.value > 0).lastIndexOf(true); // the segment that gets the rounded top
    let base = 0;
    const segments = bar.map((s, j) => {
      const y0 = r1(PAD.t + plotH * (1 - base / ymax));
      base += s.value;
      const y1 = r1(PAD.t + plotH * (1 - base / ymax));
      return s.value > 0
        ? `<rect x="${bx}" y="${y1}" width="${r1(bw)}" height="${r1(y0 - y1)}"${j === top ? ' rx="3"' : ""} fill="${s.color}"/>`
        : "";
    }).join("");
    // a transparent full-height rect keeps the whole column hoverable, even when the bar is short or empty
    return `<g><title>${esc(titles[i])}</title><rect x="${r1(PAD.l + i * slot)}" y="${PAD.t}" width="${r1(slot)}" height="${plotH}" fill="transparent"/>${segments}</g>`;
  }).join("");
  const xlabels = labels.map((l, i) => `<text x="${r1(PAD.l + i * slot + slot / 2)}" y="${SVG_H - 8}" text-anchor="middle">${esc(l)}</text>`).join("");
  return `<svg class="sv" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="${esc(description)}"><title>${esc(description)}</title>${yAxis(ymax, step)}${drawn}${xlabels}</svg>`;
}
