import { parseArgs } from 'node:util';

export const OFFLINE_MESSAGE =
  'eval:jev --offline: no fixtures yet (stub, replaced by issue #15: offline Jev eval harness with recorded fixtures)';

if (import.meta.main) {
  const { values } = parseArgs({ options: { offline: { type: 'boolean', default: false } } });
  if (!values.offline) {
    console.error('Live Jev evals are not implemented yet. Run with --offline.');
    process.exit(1);
  }
  console.log(OFFLINE_MESSAGE);
}
