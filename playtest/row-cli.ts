import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { draftRow, RowError } from './row.ts';
import { templateHeader } from './template.ts';

// `npm run playtest:row -- <log.json> --code <participant code>`: one draft CSV row from an exported
// game log (protocol sections 6 and 8, spec §6, §8). The row goes to stdout; the cross-check lines
// go to stderr, so `>> sheet.csv` appends only the row. Reads the file only; prints no row on failure.
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: { code: { type: 'string' } },
  });
  const file = positionals[0];
  if (!file || positionals.length !== 1 || !values.code) {
    throw new RowError('Usage: npm run playtest:row -- <log.json> --code <participant code>');
  }
  templateHeader();
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new RowError(
      `${file}: cannot read the file (${(error as NodeJS.ErrnoException).code ?? error})`,
    );
  }
  const { row, facts, placeholders } = draftRow(text, values.code);
  console.log(row);
  const lines = [
    `${values.code}: seed ${facts.seed}, human seat ${facts.seatIndex}, ${facts.finished ? 'finished game' : 'unfinished game'}.`,
    `meaningful_choices ${facts.meaningfulChoices}: accepted human actions without auto:true (protocol section 6).`,
    `drop_off_point ${facts.dropOffPoint}: ${facts.dropOffNote}. A candidate: confirm it against the screen.`,
    'Cross-check your scratch note (the log has no clock and cannot say who decided):',
    `  Sell Phase decisions: ${facts.sellPhaseDecisions} (sell_keep)`,
    `  Ball decisions at encounters: ${facts.ballDecisions} (ball; Shop Ball purchases are not counted, see protocol section 6)`,
    `Fill by hand, the checker refuses them: ${placeholders.join(', ')}.`,
  ];
  for (const line of lines) console.error(line);
} catch (error) {
  console.error(
    error instanceof RowError
      ? error.message
      : error instanceof Error
        ? `playtest:row failed: ${error.message}`
        : 'playtest:row failed.',
  );
  process.exitCode = 1;
}
