import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkSheet, formatProblem } from './sheet.ts';
import { templateHeader } from './template.ts';

// `npm run playtest:check -- <sheet.csv> [...]`: which cells are missing, inconsistent or look like
// personal data (protocol section 8, spec §8, §9). Reads files only; exits 1 on any problem.
try {
  const { positionals } = parseArgs({ allowPositionals: true, strict: true, options: {} });
  if (positionals.length === 0) {
    throw new RangeError('Usage: npm run playtest:check -- <sheet.csv> [<sheet.csv> ...]');
  }
  const header = templateHeader();
  let failed = false;
  for (const file of positionals) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      console.error(
        `${file}: cannot read the file (${(error as NodeJS.ErrnoException).code ?? error})`,
      );
      failed = true;
      continue;
    }
    const { rows, problems } = checkSheet(file, text, header);
    for (const problem of problems) console.error(formatProblem(problem));
    const count = problems.length;
    console.log(`${file}: ${rows} row(s), ${count === 0 ? 'no problems' : `${count} problem(s)`}`);
    if (count > 0) failed = true;
  }
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Playtest check failed.');
  process.exitCode = 1;
}
