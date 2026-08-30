import { loadLiveOpsHistory } from "../dashboard/live-ops-history.js";
import { evaluatePaperSoak } from "./paper-soak-audit.js";

const args = process.argv.slice(2);
const audit = evaluatePaperSoak(
  await loadLiveOpsHistory(readOption("--history-dir") ?? "reports/live-ops-history"),
  {
    minimumDays: numberOption("--minimum-days", 5),
    minimumExecutions: numberOption("--minimum-executions", 5),
    maximumRejectedCycles: numberOption("--maximum-rejected-cycles", 0),
    maximumStaleCycles: numberOption("--maximum-stale-cycles", 0)
  }
);
console.log(JSON.stringify(audit, null, 2));
if (!audit.passed) process.exitCode = 1;

function readOption(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}
function numberOption(name: string, fallback: number): number {
  const raw = readOption(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer.`);
  return value;
}
