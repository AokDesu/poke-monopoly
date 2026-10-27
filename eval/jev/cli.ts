import { parseArgs } from 'node:util';
import {
  formatReport,
  recordFixture,
  recordScenarios,
  runOffline,
  writePlaceholders,
} from './index.ts';

try {
  const { values } = parseArgs({
    options: {
      offline: { type: 'boolean' },
      record: { type: 'boolean' },
      placeholders: { type: 'boolean' },
      input: { type: 'string' },
      output: { type: 'string' },
    },
  });
  const modes = [values.offline, values.record, values.placeholders].filter(Boolean).length;
  if (modes !== 1)
    throw new Error('Choose exactly one mode: --offline, --record or --placeholders.');
  if ((values.input || values.output) && !values.record)
    throw new Error('--input and --output require --record.');
  if (values.offline) {
    console.log(formatReport(await runOffline()));
  } else if (values.placeholders) {
    const written = await writePlaceholders();
    console.log(`Synthetic placeholders written or updated: ${written.join(', ') || 'none'}`);
  } else if (values.input || values.output) {
    if (!values.input || !values.output)
      throw new Error('--record with --input needs --output fixture.json, and the reverse.');
    await recordFixture(values.input, values.output);
    console.log(`Recorded fixture: ${values.output}`);
  } else {
    const { recorded, current } = await recordScenarios();
    console.log(`Recorded: ${recorded.join(', ') || 'none'}`);
    console.log(`Already current, not re-recorded: ${current.join(', ') || 'none'}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Jev eval failed.');
  process.exitCode = 1;
}
