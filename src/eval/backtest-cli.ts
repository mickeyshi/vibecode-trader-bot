import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BacktestReport, MarketCalendarId } from "./interfaces.js";
import { isMarketCalendarId, validateHolidayDate } from "./market-calendars.js";
import type { StrategyMetadata } from "../strategies/registry.js";
import { parseStrategyParam } from "../strategies/strategy-params.js";

export interface BacktestCliConfig {
  fixturePath?: string;
  configPath?: string;
  symbol?: string;
  strategyId: string;
  strategyParams: Record<string, unknown>;
  compareStrategyIds: string[];
  from?: string;
  to?: string;
  startingEquity: number;
  feeRate: number;
  slippageBps: number;
  spreadBps: number;
  fillRatio: number;
  skipFillEvery?: number;
  maxDataGapDays: number;
  marketCalendar: MarketCalendarId;
  marketHolidays: string[];
  shortWindow: number;
  longWindow: number;
  minConfidence: number;
  reportPath?: string;
  reportCsvDir?: string;
  help: boolean;
}

export type BacktestCliConfigFile = Partial<Omit<BacktestCliConfig, "help" | "configPath">>;

export interface BacktestComparisonRanking {
  rank: number;
  strategyId: string;
  score: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number | null;
  closedTradeCount: number;
  dataQualityWarningCount: number;
  reason: string;
}

export interface BacktestComparisonSummary {
  rankingMethod: string;
  rankings: BacktestComparisonRanking[];
  strategyMetadata: StrategyMetadata[];
  comparison: Record<string, unknown>[];
}

const defaults: BacktestCliConfig = {
  strategyId: "moving-average-crossover",
  strategyParams: {},
  compareStrategyIds: [],
  startingEquity: 10_000,
  feeRate: 0.001,
  slippageBps: 5,
  spreadBps: 0,
  fillRatio: 1,
  maxDataGapDays: 4,
  marketCalendar: "weekday",
  marketHolidays: [],
  shortWindow: 3,
  longWindow: 5,
  minConfidence: 0.01,
  help: false
};

export async function loadBacktestCliConfig(args: string[]): Promise<BacktestCliConfig> {
  const configPath = findConfigPath(args);
  const fileConfig = configPath ? await readBacktestCliConfigFile(configPath) : {};

  return parseBacktestCliArgs(args, {
    ...defaults,
    ...fileConfig,
    ...(configPath ? { configPath } : {})
  });
}

export function parseBacktestCliArgs(
  args: string[],
  base: BacktestCliConfig = defaults
): BacktestCliConfig {
  const config: BacktestCliConfig = { ...base };
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
      case "config":
        config.configPath = requireValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "fixture":
        config.fixturePath = requireValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "symbol":
        config.symbol = requireValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "strategy":
        config.strategyId = requireValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "compare-strategies":
        config.compareStrategyIds = stringListValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "strategy-param":
        config.strategyParams = {
          ...config.strategyParams,
          ...parseStrategyParam(requireValue(rawName, value), `--${rawName}`)
        };
        if (inlineValue === undefined) index += 1;
        break;
      case "from":
        config.from = dateValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "to":
        config.to = dateValue(rawName, value);
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
      case "spread-bps":
        config.spreadBps = nonNegativeNumber(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "fill-ratio":
        config.fillRatio = ratioNumber(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "skip-fill-every":
        config.skipFillEvery = positiveInteger(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "max-data-gap-days":
        config.maxDataGapDays = positiveNumber(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "market-calendar":
        config.marketCalendar = marketCalendarValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "market-holidays":
        config.marketHolidays = holidayListValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "short-window":
        config.shortWindow = positiveInteger(rawName, value);
        config.strategyParams = { ...config.strategyParams, shortWindow: config.shortWindow };
        if (inlineValue === undefined) index += 1;
        break;
      case "long-window":
        config.longWindow = positiveInteger(rawName, value);
        config.strategyParams = { ...config.strategyParams, longWindow: config.longWindow };
        if (inlineValue === undefined) index += 1;
        break;
      case "min-confidence":
        config.minConfidence = nonNegativeNumber(rawName, value);
        config.strategyParams = { ...config.strategyParams, minConfidence: config.minConfidence };
        if (inlineValue === undefined) index += 1;
        break;
      case "report":
        config.reportPath = requireValue(rawName, value);
        if (inlineValue === undefined) index += 1;
        break;
      case "report-csv-dir":
        config.reportCsvDir = requireValue(rawName, value);
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

  return validateBacktestCliConfig(config);
}

export function summarizeBacktestReport(report: BacktestReport): Record<string, unknown> {
  return {
    strategyId: report.strategyId,
    start: report.start.toISOString(),
    end: report.end.toISOString(),
    endingEquity: Number(report.endingEquity.toFixed(2)),
    endingCash: Number(report.metrics.endingCash.toFixed(2)),
    finalPositionValue: Number(report.metrics.finalPositionValue.toFixed(2)),
    finalGrossExposure: Number(report.metrics.finalGrossExposure.toFixed(2)),
    finalRealizedPnl: Number(report.metrics.finalRealizedPnl.toFixed(2)),
    finalUnrealizedPnl: Number(report.metrics.finalUnrealizedPnl.toFixed(2)),
    totalReturnPct: Number(report.totalReturnPct.toFixed(2)),
    maxDrawdownPct: Number(report.maxDrawdownPct.toFixed(2)),
    orderCount: report.orders.length,
    fillCount: report.fills.length,
    riskRejectionCount: report.riskRejections.length,
    equityPointCount: report.equityCurve.length,
    netProfit: Number(report.metrics.netProfit.toFixed(2)),
    totalFees: Number(report.metrics.totalFees.toFixed(2)),
    skippedOrderCount: report.metrics.skippedOrderCount,
    closedTradeCount: report.metrics.closedTradeCount,
    winningTradeCount: report.metrics.winningTradeCount,
    losingTradeCount: report.metrics.losingTradeCount,
    winRatePct: Number(report.metrics.winRatePct.toFixed(2)),
    grossProfit: Number(report.metrics.grossProfit.toFixed(2)),
    grossLoss: Number(report.metrics.grossLoss.toFixed(2)),
    profitFactor:
      report.metrics.profitFactor === null ? null : Number(report.metrics.profitFactor.toFixed(2)),
    logCount: report.logs.length,
    metricCount: report.observabilityMetrics.length,
    decisionTraceCount: report.decisionTraces.length,
    alertCount: report.alerts.length,
    dataQualityWarningCount: report.dataQualityWarnings.length,
    assumptions: report.assumptions
  };
}

export function summarizeBacktestComparison(
  reports: BacktestReport[],
  strategyMetadata: StrategyMetadata[] = []
): BacktestComparisonSummary {
  return {
    rankingMethod:
      "score = totalReturnPct - maxDrawdownPct + cappedProfitFactor + closedTradeBonus - dataQualityPenalty",
    rankings: rankBacktestReports(reports),
    strategyMetadata,
    comparison: reports.map(summarizeBacktestReport)
  };
}

export function rankBacktestReports(reports: BacktestReport[]): BacktestComparisonRanking[] {
  return reports
    .map((report) => {
      const profitFactorBonus =
        report.metrics.profitFactor === null ? 0 : Math.min(report.metrics.profitFactor, 5);
      const closedTradeBonus = report.metrics.closedTradeCount > 0 ? 0.5 : 0;
      const dataQualityPenalty = report.dataQualityWarnings.length * 0.25;
      const score =
        report.totalReturnPct -
        report.maxDrawdownPct +
        profitFactorBonus +
        closedTradeBonus -
        dataQualityPenalty;

      return {
        rank: 0,
        strategyId: report.strategyId,
        score: roundNumber(score),
        totalReturnPct: roundNumber(report.totalReturnPct),
        maxDrawdownPct: roundNumber(report.maxDrawdownPct),
        profitFactor:
          report.metrics.profitFactor === null ? null : roundNumber(report.metrics.profitFactor),
        closedTradeCount: report.metrics.closedTradeCount,
        dataQualityWarningCount: report.dataQualityWarnings.length,
        reason: rankingReason(report, profitFactorBonus, closedTradeBonus, dataQualityPenalty)
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftReport = reports.find((report) => report.strategyId === left.strategyId)!;
      const rightReport = reports.find((report) => report.strategyId === right.strategyId)!;
      if (rightReport.endingEquity !== leftReport.endingEquity) {
        return rightReport.endingEquity - leftReport.endingEquity;
      }
      if (left.maxDrawdownPct !== right.maxDrawdownPct) {
        return left.maxDrawdownPct - right.maxDrawdownPct;
      }
      return left.strategyId.localeCompare(right.strategyId);
    })
    .map((ranking, index) => ({ ...ranking, rank: index + 1 }));
}

export async function writeBacktestReport(
  report: BacktestReport,
  reportPath: string
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function writeBacktestComparisonReport(
  reports: BacktestReport[],
  reportPath: string,
  strategyMetadata: StrategyMetadata[] = []
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        ...summarizeBacktestComparison(reports, strategyMetadata),
        reports
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function writeBacktestCsvReports(
  report: BacktestReport,
  reportDir: string
): Promise<void> {
  await mkdir(reportDir, { recursive: true });
  await Promise.all([
    writeFile(
      `${reportDir}/orders.csv`,
      toCsv(orderRows(report), [
        "id",
        "symbol",
        "side",
        "type",
        "quantity",
        "limitPrice",
        "status",
        "reason",
        "createdAt",
        "updatedAt"
      ]),
      "utf8"
    ),
    writeFile(
      `${reportDir}/fills.csv`,
      toCsv(fillRows(report), [
        "orderId",
        "symbol",
        "side",
        "quantity",
        "price",
        "fee",
        "timestamp"
      ]),
      "utf8"
    ),
    writeFile(
      `${reportDir}/trades.csv`,
      toCsv(tradeRows(report), [
        "id",
        "symbol",
        "side",
        "entryTimestamp",
        "exitTimestamp",
        "quantity",
        "averageEntryPrice",
        "exitPrice",
        "entryCost",
        "exitProceeds",
        "fees",
        "pnl",
        "returnPct"
      ]),
      "utf8"
    ),
    writeFile(
      `${reportDir}/risk-rejections.csv`,
      toCsv(riskRejectionRows(report), [
        "symbol",
        "side",
        "quantity",
        "limitPrice",
        "reason",
        "appliedRules",
        "timestamp"
      ]),
      "utf8"
    ),
    writeFile(
      `${reportDir}/equity-curve.csv`,
      toCsv(equityRows(report), ["timestamp", "equity"]),
      "utf8"
    ),
    writeFile(
      `${reportDir}/data-quality-warnings.csv`,
      toCsv(dataQualityRows(report), [
        "type",
        "symbol",
        "calendar",
        "previousTimestamp",
        "currentTimestamp",
        "gapDays",
        "missingSessionCount",
        "message"
      ]),
      "utf8"
    ),
    writeFile(
      `${reportDir}/logs.csv`,
      toCsv(logRows(report), ["timestamp", "level", "event", "message", "context"]),
      "utf8"
    ),
    writeFile(
      `${reportDir}/metrics.csv`,
      toCsv(metricRows(report), ["timestamp", "name", "value", "unit", "tags"]),
      "utf8"
    ),
    writeFile(
      `${reportDir}/decision-traces.csv`,
      toCsv(decisionTraceRows(report), [
        "id",
        "timestamp",
        "symbol",
        "strategyId",
        "signalAction",
        "signalConfidence",
        "signalReason",
        "hasIntent",
        "riskApproved",
        "riskReason",
        "orderId",
        "orderStatus",
        "fillCount",
        "equity"
      ]),
      "utf8"
    ),
    writeFile(
      `${reportDir}/alerts.csv`,
      toCsv(alertRows(report), ["id", "timestamp", "severity", "type", "message", "context"]),
      "utf8"
    )
  ]);
}

export function backtestHelpText(): string {
  return [
    "Usage:",
    "  npm run backtest",
    "  npm run backtest -- <fixture> <symbol>",
    "  npm run backtest -- --fixture test-fixtures/stooq-1mcay-sample.txt --symbol 1MCAY.B",
    "  npm run backtest -- --config backtest.config.example.json",
    "",
    "Options:",
    "  --config <path>           JSON config file; explicit CLI flags override file values",
    "  --fixture <path>          CSV, JSON, or Stooq .txt fixture path",
    "  --symbol <symbol>         Symbol to evaluate",
    "  --strategy <id>           Strategy id, default moving-average-crossover",
    "  --compare-strategies <ids> Comma-separated strategy ids to run and compare",
    "  --strategy-param k=v      Strategy parameter; repeatable, numbers are parsed",
    "  --from <YYYY-MM-DD>       Include candles closing on or after this date",
    "  --to <YYYY-MM-DD>         Include candles closing on or before this date",
    "  --starting-equity <n>     Starting account equity, default 10000",
    "  --fee-rate <n>            Fee rate as a decimal, default 0.001",
    "  --slippage-bps <n>        Slippage in basis points, default 5",
    "  --spread-bps <n>          Simulated bid/ask spread in basis points, default 0",
    "  --fill-ratio <n>          Fraction of each approved order filled, 0-1, default 1",
    "  --skip-fill-every <n>     Cancel every nth approved order to model missed fills",
    "  --max-data-gap-days <n>   Warn when a symbol has a candle gap above this many days, default 4",
    "  --market-calendar <id>    Data-gap calendar: weekday or crypto-24-7, default weekday",
    "  --market-holidays <list>  Comma-separated YYYY-MM-DD dates excluded from expected sessions",
    "  --short-window <n>        Moving-average short window, default 3",
    "  --long-window <n>         Moving-average long window, default 5",
    "  --min-confidence <n>      Signal confidence threshold, default 0.01",
    "  --report <path>           Write full JSON report including orders, fills, rejections, equity curve",
    "  --report-csv-dir <path>   Write report CSV files, including observability traces and alerts",
    "  --help                    Show this help"
  ].join("\n");
}

function findConfigPath(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--config") {
      return requireValue("config", args[index + 1]);
    }

    if (arg.startsWith("--config=")) {
      return requireValue("config", arg.slice("--config=".length));
    }
  }

  return undefined;
}

async function readBacktestCliConfigFile(configPath: string): Promise<BacktestCliConfigFile> {
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Backtest config must be a JSON object: ${configPath}`);
  }

  return validateBacktestCliConfigFile(parsed as Record<string, unknown>, configPath);
}

function validateBacktestCliConfigFile(
  record: Record<string, unknown>,
  configPath: string
): BacktestCliConfigFile {
  const allowedKeys = new Set([
    "fixturePath",
    "symbol",
    "strategyId",
    "strategyParams",
    "compareStrategyIds",
    "from",
    "to",
    "startingEquity",
    "feeRate",
    "slippageBps",
    "spreadBps",
    "fillRatio",
    "skipFillEvery",
    "maxDataGapDays",
    "marketCalendar",
    "marketHolidays",
    "shortWindow",
    "longWindow",
    "minConfidence",
    "reportPath",
    "reportCsvDir"
  ]);
  const config: BacktestCliConfigFile = {};

  for (const [key, value] of Object.entries(record)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown backtest config key in ${configPath}: ${key}`);
    }

    switch (key) {
      case "fixturePath":
      case "symbol":
      case "strategyId":
      case "from":
      case "to":
      case "reportPath":
      case "reportCsvDir":
        config[key] = configString(key, value, configPath);
        break;
      case "strategyParams":
        config[key] = configRecord(key, value, configPath);
        break;
      case "compareStrategyIds":
        config[key] = configStringArray(key, value, configPath);
        break;
      case "startingEquity":
      case "maxDataGapDays":
        config[key] = configPositiveNumber(key, value, configPath);
        break;
      case "feeRate":
      case "slippageBps":
      case "spreadBps":
      case "minConfidence":
        config[key] = configNonNegativeNumber(key, value, configPath);
        break;
      case "fillRatio":
        config[key] = configRatioNumber(key, value, configPath);
        break;
      case "marketCalendar":
        config[key] = configMarketCalendar(value, configPath);
        break;
      case "marketHolidays":
        config[key] = configHolidayList(value, configPath);
        break;
      case "skipFillEvery":
      case "shortWindow":
      case "longWindow":
        config[key] = configPositiveInteger(key, value, configPath);
        break;
    }
  }

  return config;
}

function validateBacktestCliConfig(config: BacktestCliConfig): BacktestCliConfig {
  if (config.shortWindow >= config.longWindow) {
    throw new Error("--short-window must be less than --long-window.");
  }

  return config;
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

function ratioNumber(name: string, value: string | undefined): number {
  const parsed = nonNegativeNumber(name, value);
  if (parsed > 1) {
    throw new Error(`--${name} must be between 0 and 1.`);
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

function stringListValue(name: string, value: string | undefined): string[] {
  const values = requireValue(name, value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error(`--${name} requires at least one value.`);
  }

  return values;
}

function dateValue(name: string, value: string | undefined): string {
  return validateDateString(requireValue(name, value), `--${name}`);
}

function marketCalendarValue(name: string, value: string | undefined): MarketCalendarId {
  const parsed = requireValue(name, value);
  if (!isMarketCalendarId(parsed)) {
    throw new Error(`--${name} must be one of: weekday, crypto-24-7.`);
  }

  return parsed;
}

function holidayListValue(name: string, value: string | undefined): string[] {
  return requireValue(name, value)
    .split(",")
    .map((holiday) => holiday.trim())
    .filter(Boolean)
    .map(validateHolidayDate);
}

function configString(key: string, value: unknown, configPath: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Backtest config ${key} must be a non-empty string in ${configPath}.`);
  }

  return key === "from" || key === "to"
    ? validateDateString(value, `Backtest config ${key}`)
    : value;
}

function configRecord(key: string, value: unknown, configPath: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Backtest config ${key} must be an object in ${configPath}.`);
  }

  return value as Record<string, unknown>;
}

function configStringArray(key: string, value: unknown, configPath: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(
      `Backtest config ${key} must be an array of non-empty strings in ${configPath}.`
    );
  }

  return value;
}

function configPositiveNumber(key: string, value: unknown, configPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Backtest config ${key} must be a positive number in ${configPath}.`);
  }

  return value;
}

function configNonNegativeNumber(key: string, value: unknown, configPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Backtest config ${key} must be a non-negative number in ${configPath}.`);
  }

  return value;
}

function configRatioNumber(key: string, value: unknown, configPath: string): number {
  const numberValue = configNonNegativeNumber(key, value, configPath);
  if (numberValue > 1) {
    throw new Error(`Backtest config ${key} must be between 0 and 1 in ${configPath}.`);
  }

  return numberValue;
}

function configMarketCalendar(value: unknown, configPath: string): MarketCalendarId {
  if (typeof value !== "string" || !isMarketCalendarId(value)) {
    throw new Error(
      `Backtest config marketCalendar must be one of weekday, crypto-24-7 in ${configPath}.`
    );
  }

  return value;
}

function configHolidayList(value: unknown, configPath: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Backtest config marketHolidays must be an array in ${configPath}.`);
  }

  return value.map((holiday) => {
    if (typeof holiday !== "string") {
      throw new Error(
        `Backtest config marketHolidays must contain YYYY-MM-DD strings in ${configPath}.`
      );
    }

    return validateHolidayDate(holiday);
  });
}

function configPositiveInteger(key: string, value: unknown, configPath: string): number {
  const numberValue = configPositiveNumber(key, value, configPath);
  if (!Number.isInteger(numberValue)) {
    throw new Error(`Backtest config ${key} must be a positive integer in ${configPath}.`);
  }

  return numberValue;
}

function validateDateString(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid date.`);
  }

  return value;
}

function rankingReason(
  report: BacktestReport,
  profitFactorBonus: number,
  closedTradeBonus: number,
  dataQualityPenalty: number
): string {
  return [
    `return ${roundNumber(report.totalReturnPct)}%`,
    `drawdown ${roundNumber(report.maxDrawdownPct)}%`,
    `profit factor bonus ${roundNumber(profitFactorBonus)}`,
    `closed trade bonus ${roundNumber(closedTradeBonus)}`,
    `data-quality penalty ${roundNumber(dataQualityPenalty)}`
  ].join("; ");
}

function roundNumber(value: number): number {
  return Number(value.toFixed(2));
}

function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ];

  return `${lines.join("\n")}\n`;
}

function csvCell(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function orderRows(report: BacktestReport): Record<string, unknown>[] {
  return report.orders.map((order) => ({
    id: order.id,
    symbol: order.intent.symbol,
    side: order.intent.side,
    type: order.intent.type,
    quantity: order.intent.quantity,
    limitPrice: order.intent.limitPrice,
    status: order.status,
    reason: order.intent.reason,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  }));
}

function fillRows(report: BacktestReport): Record<string, unknown>[] {
  return report.fills.map((fill) => ({
    orderId: fill.orderId,
    symbol: fill.symbol,
    side: fill.side,
    quantity: fill.quantity,
    price: fill.price,
    fee: fill.fee,
    timestamp: fill.timestamp
  }));
}

function tradeRows(report: BacktestReport): Record<string, unknown>[] {
  return report.trades.map((trade) => ({
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    entryTimestamp: trade.entryTimestamp,
    exitTimestamp: trade.exitTimestamp,
    quantity: trade.quantity,
    averageEntryPrice: trade.averageEntryPrice,
    exitPrice: trade.exitPrice,
    entryCost: trade.entryCost,
    exitProceeds: trade.exitProceeds,
    fees: trade.fees,
    pnl: trade.pnl,
    returnPct: trade.returnPct
  }));
}

function riskRejectionRows(report: BacktestReport): Record<string, unknown>[] {
  return report.riskRejections.map((rejection) => ({
    symbol: rejection.intent.symbol,
    side: rejection.intent.side,
    quantity: rejection.intent.quantity,
    limitPrice: rejection.intent.limitPrice,
    reason: rejection.reason,
    appliedRules: rejection.appliedRules.join(";"),
    timestamp: rejection.timestamp
  }));
}

function equityRows(report: BacktestReport): Record<string, unknown>[] {
  return report.equityCurve.map((point) => ({
    timestamp: point.timestamp,
    equity: point.equity
  }));
}

function dataQualityRows(report: BacktestReport): Record<string, unknown>[] {
  return report.dataQualityWarnings.map((warning) => ({
    type: warning.type,
    symbol: warning.symbol,
    calendar: warning.calendar,
    previousTimestamp: warning.previousTimestamp,
    currentTimestamp: warning.currentTimestamp,
    gapDays: warning.gapDays,
    missingSessionCount: warning.missingSessionCount,
    message: warning.message
  }));
}

function logRows(report: BacktestReport): Record<string, unknown>[] {
  return report.logs.map((log) => ({
    timestamp: log.timestamp,
    level: log.level,
    event: log.event,
    message: log.message,
    context: JSON.stringify(log.context ?? {})
  }));
}

function metricRows(report: BacktestReport): Record<string, unknown>[] {
  return report.observabilityMetrics.map((metric) => ({
    timestamp: metric.timestamp,
    name: metric.name,
    value: metric.value,
    unit: metric.unit,
    tags: JSON.stringify(metric.tags ?? {})
  }));
}

function decisionTraceRows(report: BacktestReport): Record<string, unknown>[] {
  return report.decisionTraces.map((trace) => ({
    id: trace.id,
    timestamp: trace.timestamp,
    symbol: trace.symbol,
    strategyId: trace.strategyId,
    signalAction: trace.signal.action,
    signalConfidence: trace.signal.confidence,
    signalReason: trace.signal.reason,
    hasIntent: trace.intent !== undefined,
    riskApproved: trace.riskDecision?.approved,
    riskReason: trace.riskDecision?.reason,
    orderId: trace.order?.id,
    orderStatus: trace.order?.status,
    fillCount: trace.fillCount,
    equity: trace.equity
  }));
}

function alertRows(report: BacktestReport): Record<string, unknown>[] {
  return report.alerts.map((alert) => ({
    id: alert.id,
    timestamp: alert.timestamp,
    severity: alert.severity,
    type: alert.type,
    message: alert.message,
    context: JSON.stringify(alert.context ?? {})
  }));
}
