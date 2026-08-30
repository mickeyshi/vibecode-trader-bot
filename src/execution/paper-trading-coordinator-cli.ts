import { parseSymbolList } from "../feeds/alpaca-iex-config.js";
import { parseStrategyParams } from "../strategies/strategy-params.js";

export interface PaperCoordinatorCli {
  symbols?: string[];
  strategyId: string;
  strategyParams: Record<string, unknown>;
  sizingMode: "fixed-notional" | "allocation";
  notionalPerTrade: number;
  targetAllocationPct: number;
  allocationWeights?: string;
  maxTotalAllocationPct: number;
  minNotionalPerTrade: number;
  maxOrderNotional: number;
  maxPositionNotional: number;
  iterations: number;
  intervalMs: number;
  maxCandleAgeMs: number;
  maxHistoryCandles: number;
  maxExecutionsPerRun: number;
  maxNotionalPerRun: number;
  dryRun: boolean;
  marketSessionMode: "regular" | "off";
  marketSessionTimeZone: string;
  marketSessionOpenTime: string;
  marketSessionCloseTime: string;
  marketSessionHolidays: string[];
  statePath: string;
  out: string;
  historyDir: string;
}

export function parsePaperCoordinatorArgs(args: string[]): PaperCoordinatorCli {
  const symbols = readOption(args, "--symbols");
  const allocationWeights = readOption(args, "--allocation-weights");

  return {
    ...(symbols ? { symbols: parseSymbolList(symbols) } : {}),
    strategyId: readOption(args, "--strategy") ?? "buy-and-hold",
    strategyParams: parseStrategyParams(readOptions(args, "--strategy-param")),
    sizingMode: sizingModeOption(args, "--sizing", "fixed-notional"),
    notionalPerTrade: numberOption(args, "--notional", 25),
    targetAllocationPct: ratioOption(args, "--target-allocation-pct", 0.0025),
    ...(allocationWeights ? { allocationWeights } : {}),
    maxTotalAllocationPct: ratioOption(args, "--max-total-allocation-pct", 0.025),
    minNotionalPerTrade: nonNegativeNumberOption(args, "--min-notional", 1),
    maxOrderNotional: numberOption(args, "--max-order-notional", 50),
    maxPositionNotional: numberOption(args, "--max-position-notional", 250),
    iterations: integerOption(args, "--iterations", 1),
    intervalMs: nonNegativeNumberOption(args, "--interval-ms", 0),
    maxCandleAgeMs: nonNegativeNumberOption(args, "--max-candle-age-ms", 15 * 60_000),
    maxHistoryCandles: integerOption(args, "--max-history-candles", 100),
    maxExecutionsPerRun: nonNegativeIntegerOption(args, "--max-executions-per-run", 5),
    maxNotionalPerRun: nonNegativeNumberOption(args, "--max-notional-per-run", 250),
    dryRun: booleanFlag(args, "--dry-run"),
    marketSessionMode: marketSessionModeOption(args, "--market-session", "regular"),
    marketSessionTimeZone: readOption(args, "--market-session-time-zone") ?? "America/New_York",
    marketSessionOpenTime: readOption(args, "--market-session-open") ?? "09:30",
    marketSessionCloseTime: readOption(args, "--market-session-close") ?? "16:00",
    marketSessionHolidays: listOption(args, "--market-session-holidays"),
    statePath: readOption(args, "--state") ?? "reports/paper-trading.sqlite",
    out: readOption(args, "--out") ?? "reports/live-ops-snapshot.json",
    historyDir: readOption(args, "--history-dir") ?? "reports/live-ops-history"
  };
}

function booleanFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function readOptions(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${name} requires a value.`);
      }

      values.push(value);
      index += 1;
      continue;
    }

    if (arg?.startsWith(`${name}=`)) {
      const value = arg.slice(name.length + 1);
      if (!value) {
        throw new Error(`${name} requires a value.`);
      }

      values.push(value);
    }
  }

  return values;
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

function listOption(args: string[], name: string): string[] {
  const raw = readOption(args, name);
  if (raw === undefined) return [];

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function numberOption(args: string[], name: string, fallback: number): number {
  const value = nonNegativeNumberOption(args, name, fallback);
  if (value <= 0) {
    throw new Error(`${name} must be positive.`);
  }

  return value;
}

function marketSessionModeOption(
  args: string[],
  name: string,
  fallback: PaperCoordinatorCli["marketSessionMode"]
): PaperCoordinatorCli["marketSessionMode"] {
  const raw = readOption(args, name);
  if (raw === undefined) return fallback;

  if (raw === "regular" || raw === "off") {
    return raw;
  }

  throw new Error(`${name} must be regular or off.`);
}

function integerOption(args: string[], name: string, fallback: number): number {
  const value = numberOption(args, name, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }

  return value;
}

function nonNegativeIntegerOption(args: string[], name: string, fallback: number): number {
  const value = nonNegativeNumberOption(args, name, fallback);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }

  return value;
}

function nonNegativeNumberOption(args: string[], name: string, fallback: number): number {
  const raw = readOption(args, name);
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }

  return value;
}

function ratioOption(args: string[], name: string, fallback: number): number {
  const value = nonNegativeNumberOption(args, name, fallback);
  if (value <= 0 || value > 1) {
    throw new Error(`${name} must be greater than 0 and less than or equal to 1.`);
  }

  return value;
}

function sizingModeOption(
  args: string[],
  name: string,
  fallback: PaperCoordinatorCli["sizingMode"]
): PaperCoordinatorCli["sizingMode"] {
  const raw = readOption(args, name);
  if (raw === undefined) return fallback;

  if (raw === "fixed-notional" || raw === "allocation") {
    return raw;
  }

  throw new Error(`${name} must be fixed-notional or allocation.`);
}
