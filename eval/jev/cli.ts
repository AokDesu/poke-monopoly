import { parseArgs } from 'node:util';
import { OFFLINE_MESSAGE } from './index.ts';

const { values } = parseArgs({ options: { offline: { type: 'boolean', default: false } } });
if (!values.offline) {
  console.error('Live Jev evals are not implemented yet. Run with --offline.');
  process.exit(1);
}
console.log(OFFLINE_MESSAGE);
