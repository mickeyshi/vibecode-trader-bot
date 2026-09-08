import type { Candle } from "../core/types.js";
import {
  DEFAULT_ETF_MOMENTUM_ALLOCATION_CONFIG,
  EtfRelativeMomentumAllocator,
  type EtfMomentumAllocationConfig
} from "../portfolio/etf-relative-momentum-allocator.js";

export interface EtfMomentumConfig extends EtfMomentumAllocationConfig {
  transactionCostBps: number;
}

export interface EtfMomentumResult {
  strategy: PerformanceSummary;
  benchmark: PerformanceSummary;
  rebalanceCount: number;
  firstDate: string;
  lastDate: string;
}

export interface PerformanceSummary {
  endingEquity: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  annualizedVolatilityPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  turnover: number;
}

export const DEFAULT_ETF_MOMENTUM_CONFIG: EtfMomentumConfig = {
  ...DEFAULT_ETF_MOMENTUM_ALLOCATION_CONFIG,
  transactionCostBps: 10
};

export function runEtfRelativeMomentum(
  candles: Candle[],
  config: EtfMomentumConfig = DEFAULT_ETF_MOMENTUM_CONFIG,
  startingEquity = 100_000,
  evaluationStartDate?: string
): EtfMomentumResult {
  validateConfig(config);
  const byDate = groupByDate(candles);
  const symbolCount = new Set(candles.map((candle) => candle.symbol)).size;
  const dates = [...byDate.entries()]
    .filter(([, bars]) => new Set(bars.map((bar) => bar.symbol)).size === symbolCount)
    .map(([date]) => date)
    .sort();
  if (dates.length <= config.trendWindow) throw new Error("Not enough daily candles for strategy.");

  const strategy = simulate(dates, byDate, config, startingEquity, false);
  const benchmark = simulate(dates, byDate, config, startingEquity, true);
  return {
    strategy: summarize(strategy.equity, strategy.turnover, startingEquity, evaluationStartDate),
    benchmark: summarize(benchmark.equity, benchmark.turnover, startingEquity, evaluationStartDate),
    rebalanceCount: strategy.rebalanceCount,
    firstDate: dates[0]!,
    lastDate: dates.at(-1)!
  };
}

function simulate(
  dates: string[],
  byDate: Map<string, Candle[]>,
  config: EtfMomentumConfig,
  startingEquity: number,
  benchmark: boolean
): {
  equity: { date: string; value: number }[];
  turnover: { date: string; value: number }[];
  rebalanceCount: number;
} {
  let cash = startingEquity;
  const turnover: { date: string; value: number }[] = [];
  let rebalanceCount = 0;
  let priorMonth = "";
  const shares = new Map<string, number>();
  const histories = new Map<string, number[]>();
  const equity: { date: string; value: number }[] = [];
  const allocator = new EtfRelativeMomentumAllocator(config);

  for (const date of dates) {
    const bars = byDate.get(date)!;
    const month = date.slice(0, 7);
    if (month !== priorMonth) {
      const prices = new Map(bars.map((bar) => [bar.symbol, bar.open]));
      const currentEquity = portfolioValue(cash, shares, prices);
      const warmedUp = [...histories.values()].every(
        (history) => history.length >= Math.max(config.trendWindow, config.momentumWindow)
      );
      const targets = !warmedUp
        ? new Map<string, number>()
        : benchmark
          ? new Map(prices.has("SPY") ? [["SPY", config.maxGrossWeight]] : [])
          : new Map(
              allocator
                .allocate({ closeHistoryBySymbol: histories })
                .targets.map((target) => [target.symbol, target.targetWeight])
            );
      for (const symbol of new Set([...shares.keys(), ...targets.keys()])) {
        const price = prices.get(symbol);
        if (!price) continue;
        const desiredValue = currentEquity * (targets.get(symbol) ?? 0);
        const currentValue = (shares.get(symbol) ?? 0) * price;
        const tradedValue = Math.abs(desiredValue - currentValue);
        const cost = tradedValue * (config.transactionCostBps / 10_000);
        cash += currentValue - desiredValue - cost;
        shares.set(symbol, desiredValue / price);
        turnover.push({ date, value: tradedValue / currentEquity });
      }
      priorMonth = month;
      rebalanceCount += 1;
    }

    const closePrices = new Map(bars.map((bar) => [bar.symbol, bar.close]));
    equity.push({ date, value: portfolioValue(cash, shares, closePrices) });
    for (const bar of bars) {
      const history = histories.get(bar.symbol) ?? [];
      history.push(bar.close);
      histories.set(bar.symbol, history);
    }
  }
  return { equity, turnover, rebalanceCount };
}

function summarize(
  allEquity: { date: string; value: number }[],
  turnoverEntries: { date: string; value: number }[],
  startingEquity: number,
  evaluationStartDate?: string
): PerformanceSummary {
  const equity = evaluationStartDate
    ? allEquity.filter((point) => point.date >= evaluationStartDate)
    : allEquity;
  if (equity.length === 0) throw new Error("Evaluation period contains no candles.");
  const baselineEquity = evaluationStartDate ? equity[0]!.value : startingEquity;
  const endingEquity = equity.at(-1)!.value;
  const dailyReturns = equity
    .slice(1)
    .map((point, index) => point.value / equity[index]!.value - 1);
  const years = Math.max(equity.length / 252, 1 / 252);
  const annualizedVolatility = standardDeviation(dailyReturns) * Math.sqrt(252);
  const annualizedReturn = Math.pow(endingEquity / baselineEquity, 1 / years) - 1;
  let peak = baselineEquity;
  let drawdown = 0;
  for (const { value } of equity) {
    peak = Math.max(peak, value);
    drawdown = Math.max(drawdown, (peak - value) / peak);
  }
  return {
    endingEquity: round(endingEquity),
    totalReturnPct: round((endingEquity / baselineEquity - 1) * 100),
    annualizedReturnPct: round(annualizedReturn * 100),
    annualizedVolatilityPct: round(annualizedVolatility * 100),
    sharpeRatio: round(annualizedVolatility === 0 ? 0 : annualizedReturn / annualizedVolatility),
    maxDrawdownPct: round(drawdown * 100),
    turnover: round(
      turnoverEntries
        .filter((entry) => !evaluationStartDate || entry.date >= evaluationStartDate)
        .reduce((sum, entry) => sum + entry.value, 0)
    )
  };
}

function groupByDate(candles: Candle[]): Map<string, Candle[]> {
  const result = new Map<string, Candle[]>();
  for (const candle of candles) {
    const date = candle.openTime.toISOString().slice(0, 10);
    const values = result.get(date) ?? [];
    values.push(candle);
    result.set(date, values);
  }
  return result;
}

function portfolioValue(cash: number, shares: Map<string, number>, prices: Map<string, number>) {
  return [...shares.entries()].reduce(
    (total, [symbol, quantity]) => total + quantity * (prices.get(symbol) ?? 0),
    cash
  );
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function validateConfig(config: EtfMomentumConfig): void {
  for (const value of [
    config.momentumWindow,
    config.trendWindow,
    config.volatilityWindow,
    config.selectionCount
  ]) {
    if (!Number.isInteger(value) || value <= 0)
      throw new Error("Strategy windows must be positive integers.");
  }
  if (config.maxAssetWeight <= 0 || config.maxGrossWeight <= 0 || config.maxGrossWeight > 1) {
    throw new Error("Strategy weights must be positive and gross weight cannot exceed one.");
  }
  if (config.transactionCostBps < 0 || config.targetAnnualVolatility <= 0) {
    throw new Error("Volatility target must be positive and costs non-negative.");
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
