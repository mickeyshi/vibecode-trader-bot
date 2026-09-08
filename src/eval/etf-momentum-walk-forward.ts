import type { Candle } from "../core/types.js";
import {
  DEFAULT_ETF_MOMENTUM_CONFIG,
  runEtfRelativeMomentum,
  type EtfMomentumConfig,
  type PerformanceSummary
} from "./etf-relative-momentum.js";

export interface WalkForwardFold {
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  selectedConfig: EtfMomentumConfig;
  trainingSharpe: number;
  testStrategy: PerformanceSummary;
  testBenchmark: PerformanceSummary;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  compoundedStrategyReturnPct: number;
  compoundedBenchmarkReturnPct: number;
  averageTestSharpe: number;
  worstTestDrawdownPct: number;
}

export function runEtfMomentumWalkForward(
  candles: Candle[],
  candidates: EtfMomentumConfig[] = defaultCandidates(),
  trainSessions = 504,
  testSessions = 252
): WalkForwardResult {
  if (candidates.length === 0) throw new Error("Walk-forward requires candidate configurations.");
  const symbols = new Set(candles.map((candle) => candle.symbol));
  const dateCounts = new Map<string, Set<string>>();
  for (const candle of candles) {
    const date = candle.openTime.toISOString().slice(0, 10);
    const values = dateCounts.get(date) ?? new Set<string>();
    values.add(candle.symbol);
    dateCounts.set(date, values);
  }
  const dates = [...dateCounts.entries()]
    .filter(([, values]) => values.size === symbols.size)
    .map(([date]) => date)
    .sort();
  const folds: WalkForwardFold[] = [];
  for (let start = 0; start + trainSessions + testSessions <= dates.length; start += testSessions) {
    const trainEnd = start + trainSessions - 1;
    const testStart = trainEnd + 1;
    const testEnd = testStart + testSessions - 1;
    const training = candlesBetween(candles, dates[start]!, dates[trainEnd]!);
    const selected = candidates
      .map((config) => ({ config, result: runEtfRelativeMomentum(training, config) }))
      .sort(
        (left, right) => right.result.strategy.sharpeRatio - left.result.strategy.sharpeRatio
      )[0]!;
    const warmup = Math.max(selected.config.trendWindow, selected.config.momentumWindow) + 1;
    const testing = candlesBetween(
      candles,
      dates[Math.max(start, testStart - warmup)]!,
      dates[testEnd]!
    );
    const result = runEtfRelativeMomentum(testing, selected.config, 100_000, dates[testStart]!);
    folds.push({
      trainStart: dates[start]!,
      trainEnd: dates[trainEnd]!,
      testStart: dates[testStart]!,
      testEnd: dates[testEnd]!,
      selectedConfig: selected.config,
      trainingSharpe: selected.result.strategy.sharpeRatio,
      testStrategy: result.strategy,
      testBenchmark: result.benchmark
    });
  }
  if (folds.length === 0) throw new Error("Not enough common history for one walk-forward fold.");
  return {
    folds,
    compoundedStrategyReturnPct: round(
      compound(folds.map((fold) => fold.testStrategy.totalReturnPct))
    ),
    compoundedBenchmarkReturnPct: round(
      compound(folds.map((fold) => fold.testBenchmark.totalReturnPct))
    ),
    averageTestSharpe: round(average(folds.map((fold) => fold.testStrategy.sharpeRatio))),
    worstTestDrawdownPct: round(Math.max(...folds.map((fold) => fold.testStrategy.maxDrawdownPct)))
  };
}

export function defaultCandidates(): EtfMomentumConfig[] {
  return [63, 126, 189].flatMap((momentumWindow) =>
    [150, 200, 250].map((trendWindow) => ({
      ...DEFAULT_ETF_MOMENTUM_CONFIG,
      momentumWindow,
      trendWindow
    }))
  );
}

function candlesBetween(candles: Candle[], start: string, end: string): Candle[] {
  return candles.filter((candle) => {
    const date = candle.openTime.toISOString().slice(0, 10);
    return date >= start && date <= end;
  });
}
function compound(values: number[]): number {
  return (values.reduce((total, value) => total * (1 + value / 100), 1) - 1) * 100;
}
function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function round(value: number): number {
  return Number(value.toFixed(4));
}
