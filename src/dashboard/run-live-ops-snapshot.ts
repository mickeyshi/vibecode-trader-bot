import { AlpacaOrderExecutor } from "../execution/alpaca-order-executor.js";
import { loadAlpacaTradingConfig } from "../execution/alpaca-trading-config.js";
import { writeLiveOpsHistorySnapshot } from "./live-ops-history.js";
import { buildLiveOpsSnapshot, loadLiveOpsSnapshotConfig } from "./live-ops-snapshot.js";

const cli = parseArgs(process.argv.slice(2));
const tradingConfig = loadAlpacaTradingConfig();
const snapshotConfig = loadLiveOpsSnapshotConfig();
const executor = new AlpacaOrderExecutor(tradingConfig);
const accountSnapshot = await executor.getAccountSnapshot();
const liveOpsSnapshot = buildLiveOpsSnapshot(accountSnapshot, snapshotConfig);
const result = await writeLiveOpsHistorySnapshot(liveOpsSnapshot, {
  historyDir: cli.historyDir,
  latestPath: cli.out
});
const json = JSON.stringify(result.latestSnapshot, null, 2);

console.log(json);

interface LiveOpsSnapshotCli {
  out: string;
  historyDir: string;
}

function parseArgs(args: string[]): LiveOpsSnapshotCli {
  return {
    out: readOption(args, "--out") ?? "reports/live-ops-snapshot.json",
    historyDir: readOption(args, "--history-dir") ?? "reports/live-ops-history"
  };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg === name);
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}
