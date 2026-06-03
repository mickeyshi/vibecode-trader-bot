import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BacktestReport } from "./interfaces.js";

export interface BacktestCliConfig {
  fixturePath?: string;
  symbol?: string;
  startingEquity: number;
  feeRate: number;
  slippageBps: number;
  shortWindow: number;
  longWindow: number;
  minConfidence: number;
  reportPath?: string;
  help: boolean;
}

const defaults: BacktestCliConfig = {
  startingEquity: 10_000,
  feeRate: 0.001,
  slippageBps: 5,
  shortWindow: 3,
  longWindow: 5,
  minConfidence: 0.01,
  help: false
};

export function parseBacktestCliArgs(args: string[]): BacktestCliConfig {
  const config: BacktestCliConfig = { ...defaults };
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];

    switch (rawName) {
      case "help":
        config.help = true;
        break;
      case "fixture":
        config.fixturePath = requireValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "symbol":
        config.symbol = requireValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "starting-equity":
        config.startingEquity = positiveNumber(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "fee-rate":
        config.feeRate = nonNegativeNumber(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "slippage-bps":
        config.slippageBps = nonNegativeNumber(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "short-window":
        config.shortWindow = positiveInteger(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "long-window":
        config.longWindow = positiveInteger(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "min-confidence":
        config.minConfidence = nonNegativeNumber(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "report":
        config.reportPath = requireValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      default:
        throw new Error(`Unknown option: --${rawName}`);
    }
  }

  if (!config.fixturePath && positionals[0]) {
    config.fixturePath = positionals[0];
  }

  if (!config.symbol && positionals[1]) {
    config.symbol = positionals[1];
  }

  if (config.shortWindow >= config.longWindow) {
    throw new Error("--short-window must be less than --long-window.");
  }

  return config;
}

export function summarizeBacktestReport(report: BacktestReport): Record<string, unknown> {
  return {
    strategyId: report.strategyId,
    start: report.start.toISOString(),
    end: report.end.toISOString(),
    endingEquity: Number(report.endingEquity.toFixed(2)),
    totalReturnPct: Number(report.totalReturnPct.toFixed(2)),
    maxDrawdownPct: Number(report.maxDrawdownPct.toFixed(2)),
    orderCount: report.orders.length,
    fillCount: report.fills.length,
    riskRejectionCount: report.riskRejections.length,
    equityPointCount: report.equityCurve.length,
    assumptions: report.assumptions
  };
}

export async function writeBacktestReport(
  report: BacktestReport,
  reportPath: string
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function backtestHelpText(): string {
  return [
    "Usage:",
    "  npm run backtest",
    "  npm run backtest -- <fixture> <symbol>",
    "  npm run backtest -- --fixture test-fixtures/stooq-1mcay-sample.txt --symbol 1MCAY.B",
    "",
    "Options:",
    "  --fixture <path>          CSV, JSON, or Stooq .txt fixture path",
    "  --symbol <symbol>         Symbol to evaluate",
    "  --starting-equity <n>     Starting account equity, default 10000",
    "  --fee-rate <n>            Fee rate as a decimal, default 0.001",
    "  --slippage-bps <n>        Slippage in basis points, default 5",
    "  --short-window <n>        Moving-average short window, default 3",
    "  --long-window <n>         Moving-average long window, default 5",
    "  --min-confidence <n>      Signal confidence threshold, default 0.01",
    "  --report <path>           Write full JSON report including orders, fills, rejections, equity curve",
    "  --help                    Show this help"
  ].join("\n");
}

function requireValue(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`--${name} requires a value.`);
  }

  return value;
}

function positiveNumber(name: string, value: string | undefined): number {
  const parsed = Number(requireValue(name, value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number.`);
  }

  return parsed;
}

function nonNegativeNumber(name: string, value: string | undefined): number {
  const parsed = Number(requireValue(name, value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative number.`);
  }

  return parsed;
}

function positiveInteger(name: string, value: string | undefined): number {
  const parsed = positiveNumber(name, value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  return parsed;
}
