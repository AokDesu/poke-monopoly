// Plain horizontal bar charts as static SVG text (issue #219): no chart library, no script, no
// external reference. Every bar is labelled with its count and its n, so the picture alone still
// carries the numbers. No IO: the report command writes the text to a file.

export type Bar = { label: string; count: number; n: number };
export type BarGroup = { heading?: string; bars: Bar[] };

const WIDTH = 640;
const LABEL_RIGHT = 300;
const BAR_LEFT = 312;
const BAR_MAX = 220;
const ROW = 28;
const HEADING = 30;
const TOP = 48;

/** The only characters that can break out of SVG text or an attribute. */
export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export const countOfN = (bar: Bar) => `${bar.count} of ${bar.n}`;

/**
 * One chart: bars are as long as their count, on one scale for the whole chart (the largest n), so
 * a short bar is a small count and never a rescaled one. A bar of 0 has no length and still reads
 * "0 of n". `title` and `description` are for readers who cannot see the picture.
 */
export function barChartSvg(title: string, groups: readonly BarGroup[]): string {
  const scale = Math.max(1, ...groups.flatMap((group) => group.bars.map((bar) => bar.n)));
  const named = (group: BarGroup, bar: Bar) =>
    `${group.heading === undefined ? '' : `${group.heading}, `}${bar.label}: ${countOfN(bar)}`;
  const summary = groups.flatMap((group) => group.bars.map((bar) => named(group, bar))).join('; ');
  const body: string[] = [];
  let y = TOP;
  for (const group of groups) {
    if (group.heading !== undefined) {
      body.push(
        `  <text x="16" y="${y + 14}" font-size="14" font-weight="bold">${escapeXml(group.heading)}</text>`,
      );
      y += HEADING;
    }
    for (const bar of group.bars) {
      const length = Math.round((bar.count / scale) * BAR_MAX);
      const text = escapeXml(named(group, bar));
      body.push(
        `  <g>`,
        `    <title>${text}</title>`,
        `    <text x="${LABEL_RIGHT}" y="${y + 15}" font-size="14" text-anchor="end">${escapeXml(bar.label)}</text>`,
        `    <rect x="${BAR_LEFT}" y="${y + 2}" width="${length}" height="18" fill="#3b6ea5"/>`,
        `    <text x="${BAR_LEFT + length + 8}" y="${y + 15}" font-size="14">${countOfN(bar)}</text>`,
        `  </g>`,
      );
      y += ROW;
    }
    y += 8;
  }
  const height = y + 8;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-labelledby="title desc" font-family="sans-serif" fill="#1a1a1a">`,
    `  <title id="title">${escapeXml(title)}</title>`,
    `  <desc id="desc">${escapeXml(summary)}</desc>`,
    `  <rect width="${WIDTH}" height="${height}" fill="#ffffff"/>`,
    `  <text x="16" y="28" font-size="16" font-weight="bold">${escapeXml(title)}</text>`,
    ...body,
    `</svg>`,
    '',
  ].join('\n');
}
