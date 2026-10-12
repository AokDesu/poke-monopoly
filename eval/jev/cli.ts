import { parseArgs } from 'node:util';
import { formatReport, recordFixture, runOffline } from './index.ts';

try {
  const { values } = parseArgs({
    options: {
      offline: { type: 'boolean' },
      record: { type: 'boolean' },
      fixtures: { type: 'string' },
      input: { type: 'string' },
      output: { type: 'string' },
    },
  });
  if (Boolean(values.offline) === Boolean(values.record))
    throw new Error('Choose exactly one mode: --offline or --record.');
  if (values.offline) {
    if (values.input || values.output) throw new Error('--input and --output require --record.');
    console.log(formatReport(await runOffline(values.fixtures)));
  } else {
    if (values.fixtures) throw new Error('--fixtures requires --offline.');
    if (!values.input || !values.output)
      throw new Error('--record requires --input scenario.json --output fixture.json.');
    await recordFixture(values.input, values.output);
    console.log(`Recorded fixture: ${values.output}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Jev eval failed.');
  process.exitCode = 1;
}
