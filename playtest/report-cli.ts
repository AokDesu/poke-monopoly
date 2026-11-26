import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { renderResults, readSheets } from './report.ts';
import { formatProblem, PRIVACY_PATTERN } from './sheet.ts';
import { templateHeader } from './template.ts';

// `npm run playtest:report -- <sheet.csv> [...]`: the Human-layer result tables and charts with n,
// written as `results.md` and three SVG files next to the sheets (protocol section 8, spec §8,
// §10 C5). Reads and writes files only. On any problem in a sheet it prints the problems, exits 1
// and writes nothing, so a report is never made from a sheet that is wrong.
try {
  const { positionals } = parseArgs({ allowPositionals: true, strict: true, options: {} });
  if (positionals.length === 0) {
    throw new RangeError('Usage: npm run playtest:report -- <sheet.csv> [<sheet.csv> ...]');
  }
  const folders = new Set(positionals.map((file) => dirname(resolve(file))));
  if (folders.size > 1) {
    throw new RangeError(
      'The sheets are in different folders. Pass the sheets of one round: the results are written next to them.',
    );
  }
  const folder = [...folders][0]!;
  const header = templateHeader();
  const sheets = [...positionals]
    .sort((a, b) => (basename(a) < basename(b) ? -1 : basename(a) > basename(b) ? 1 : 0))
    .map((file) => {
      try {
        return { name: basename(file), text: readFileSync(file, 'utf8') };
      } catch (error) {
        throw new RangeError(
          `${file}: cannot read the file (${(error as NodeJS.ErrnoException).code ?? error})`,
          { cause: error },
        );
      }
    });
  const { sessions, problems } = readSheets(sheets, header);
  if (problems.length === 0 && sessions.length === 0) {
    throw new RangeError('The sheets hold no session rows, so there is nothing to report.');
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(formatProblem(problem));
    console.error(
      `${problems.length} problem(s): no results written. Fix the sheets (npm run playtest:check shows the same cells), then run this again.`,
    );
    process.exitCode = 1;
  } else {
    const { markdown, charts } = renderResults(
      sessions,
      sheets.map((sheet) => sheet.name),
    );
    const files = [
      { file: 'results.md', text: markdown },
      ...charts.map((c) => ({ file: c.file, text: c.svg })),
    ];
    // The privacy check of the sheets, on what is about to be written. The fixed SVG namespace
    // declaration is a link by form and holds no data, so it is left out of the check.
    for (const { file, text } of files) {
      if (PRIVACY_PATTERN.test(text.replace(/ xmlns="[^"]*"/, ''))) {
        throw new Error(
          `${file} would look like personal data (an @, a link or a phone-like number); nothing written.`,
        );
      }
    }
    for (const { file, text } of files) writeFileSync(join(folder, file), text);
    console.log(`${sessions.length} session(s) from ${sheets.length} sheet(s).`);
    for (const { file } of files) console.log(`wrote ${join(folder, file)}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Playtest report failed.');
  process.exitCode = 1;
}
