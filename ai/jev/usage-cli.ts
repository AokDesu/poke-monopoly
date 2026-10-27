import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { dailyBudgetFromEnv, readUsageLog, USAGE_LOG_PATH } from './spend.ts';
import { formatUsageReport, usageReport } from './usage-report.ts';

// `npm run usage [-- --log <file>]`: spend and decision time from the usage log (spec §9).
try {
  const { values } = parseArgs({ options: { log: { type: 'string', default: USAGE_LOG_PATH } } });
  const { lines, invalid } = readUsageLog(values.log);
  const report = formatUsageReport(usageReport(lines), {
    path: existsSync(values.log) ? values.log : `${values.log} (no file yet: no live requests)`,
    invalid,
    dailyBudgetThb: dailyBudgetFromEnv(),
  });
  for (const line of report) console.log(line);
  if (invalid.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Jev usage report failed.');
  process.exitCode = 1;
}
