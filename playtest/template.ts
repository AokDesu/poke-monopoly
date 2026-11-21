import { readFileSync } from 'node:fs';
import { COLUMNS } from './sheet.ts';

/** The empty template both commands follow (protocol section 1). */
export const TEMPLATE_URL = new URL('../docs/playtest/session-sheet.csv', import.meta.url);

/** The template's header, which the checker compares every sheet with. */
export function templateHeader(): string[] {
  const first = readFileSync(TEMPLATE_URL, 'utf8').split(/\r?\n/, 1)[0] ?? '';
  const header = first.split(',');
  if (header.length !== COLUMNS.length || header.some((name, i) => name !== COLUMNS[i])) {
    throw new Error(
      'docs/playtest/session-sheet.csv no longer matches the columns in playtest/sheet.ts; update both together.',
    );
  }
  return header;
}
