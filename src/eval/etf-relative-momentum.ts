import type { Candle } from "../core/types.js";
import {
  DEFAULT_ETF_MOMENTUM_ALLOCATION_CONFIG,
  EtfRelativeMomentumAllocator,
  type EtfMomentumAllocationConfig
} from "../portfolio/etf-relative-momentum-allocator.js";

export interface EtfMomentumConfig extends EtfMomentumAllocationConfig {
  transactionCostBps: number;
  rebalanceDelaySessions: number;
  skipEveryNthRebalance: number;
  cashAnnualYieldPct: number;
}

export interface EtfMomentumResult {
  strategy: PerformanceSummary;
  benchmark: PerformanceSummary;
  rebalanceCount: number;
  missedRebalanceCount: number;
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
  annualReturnsPct: Record<string, number>;
  symbolContributionPct: Record<string, number>;
  regimeContributionPct: Record<MarketRegime, number>;
}

export type MarketRegime = "warmup" | "risk-on" | "risk-off";

interface ContributionEntry {
  date: string;
  symbol: string;
  regime: MarketRegime;
  value: number;
}

export const DEFAULT_ETF_MOMENTUM_CONFIG: EtfMomentumConfig = {
  ...DEFAULT_ETF_MOMENTUM_ALLOCATION_CONFIG,
  transactionCostBps: 10,
  rebalanceDelaySessions: 0,
  skipEveryNthRebalance: 0,
  cashAnnualYieldPct: 0
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
    strategy: summarize(
      strategy.equity,
      strategy.turnover,
      strategy.contributions,
      startingEquity,
      config.cashAnnualYieldPct,
      evaluationStartDate
    ),
    benchmark: summarize(
      benchmark.equity,
      benchmark.turnover,
      benchmark.contributions,
      startingEquity,
      config.cashAnnualYieldPct,
      evaluationStartDate
    ),
    rebalanceCount: strategy.rebalanceCount,
    missedRebalanceCount: strategy.missedRebalanceCount,
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
  contributions: ContributionEntry[];
  rebalanceCount: number;
  missedRebalanceCount: number;
} {
  let cash = startingEquity;
  const turnover: { date: string; value: number }[] = [];
  const contributions: ContributionEntry[] = [];
  let rebalanceCount = 0;
  let missedRebalanceCount = 0;
  let scheduledRebalanceCount = 0;
  let activeMonth = "";
  let sessionInMonth = 0;
  const shares = new Map<string, number>();
  const histories = new Map<string, number[]>();
  const equity: { date: string; value: number }[] = [];
  const priorCloses = new Map<string, number>();
  const allocator = new EtfRelativeMomentumAllocator(config);

  for (const date of dates) {
    const bars = byDate.get(date)!;
    const regime = classifyRegime(histories.get("SPY") ?? []);
    for (const bar of bars) {
      const priorClose = priorCloses.get(bar.symbol);
      const quantity = shares.get(bar.symbol) ?? 0;
      if (priorClose !== undefined && quantity !== 0) {
        contributions.push({
          date,
          symbol: bar.symbol,
          regime,
          value: quantity * (bar.open - priorClose)
        });
      }
    }
    const month = date.slice(0, 7);
    if (month !== activeMonth) {
      activeMonth = month;
      sessionInMonth = 0;
    }
    if (sessionInMonth === config.rebalanceDelaySessions) {
      scheduledRebalanceCount += 1;
      const skip =
        config.skipEveryNthRebalance > 0 &&
        scheduledRebalanceCount % config.skipEveryNthRebalance === 0;
      if (skip) {
        missedRebalanceCount += 1;
      } else {
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
          contributions.push({ date, symbol, regime, value: -cost });
        }
        rebalanceCount += 1;
      }
    }

    const closePrices = new Map(bars.map((bar) => [bar.symbol, bar.close]));
    if (cash > 0 && config.cashAnnualYieldPct > 0) {
      const interest = cash * (config.cashAnnualYieldPct / 100 / 252);
      cash += interest;
      contributions.push({ date, symbol: "CASH", regime, value: interest });
    }
    for (const bar of bars) {
      const quantity = shares.get(bar.symbol) ?? 0;
      if (quantity !== 0) {
        contributions.push({
          date,
          symbol: bar.symbol,
          regime,
          value: quantity * (bar.close - bar.open)
        });
      }
      priorCloses.set(bar.symbol, bar.close);
    }
    equity.push({ date, value: portfolioValue(cash, shares, closePrices) });
    for (const bar of bars) {
      const history = histories.get(bar.symbol) ?? [];
      history.push(bar.close);
      histories.set(bar.symbol, history);
    }
    sessionInMonth += 1;
  }
  return { equity, turnover, contributions, rebalanceCount, missedRebalanceCount };
}

function summarize(
  allEquity: { date: string; value: number }[],
  turnoverEntries: { date: string; value: number }[],
  contributionEntries: ContributionEntry[],
  startingEquity: number,
  cashAnnualYieldPct: number,
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
    sharpeRatio: round(
      annualizedVolatility === 0
        ? 0
        : (annualizedReturn - cashAnnualYieldPct / 100) / annualizedVolatility
    ),
    maxDrawdownPct: round(drawdown * 100),
    turnover: round(
      turnoverEntries
        .filter((entry) => !evaluationStartDate || entry.date >= evaluationStartDate)
        .reduce((sum, entry) => sum + entry.value, 0)
    ),
    annualReturnsPct: annualReturns(equity, baselineEquity),
    symbolContributionPct: symbolContributions(
      contributionEntries,
      baselineEquity,
      evaluationStartDate
    ),
    regimeContributionPct: regimeContributions(
      contributionEntries,
      baselineEquity,
      evaluationStartDate
    )
  };
}

function symbolContributions(
  entries: ContributionEntry[],
  baselineEquity: number,
  evaluationStartDate?: string
): Record<string, number> {
  const values = new Map<string, number>();
  for (const entry of entries) {
    if (evaluationStartDate && entry.date <= evaluationStartDate) continue;
    values.set(entry.symbol, (values.get(entry.symbol) ?? 0) + entry.value);
  }
  return Object.fromEntries(
    [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([symbol, value]) => [symbol, round((value / baselineEquity) * 100)])
  );
}

function regimeContributions(
  entries: ContributionEntry[],
  baselineEquity: number,
  evaluationStartDate?: string
): Record<MarketRegime, number> {
  const values: Record<MarketRegime, number> = { warmup: 0, "risk-on": 0, "risk-off": 0 };
  for (const entry of entries) {
    if (evaluationStartDate && entry.date <= evaluationStartDate) continue;
    values[entry.regime] += entry.value;
  }
  return {
    warmup: round((values.warmup / baselineEquity) * 100),
    "risk-on": round((values["risk-on"] / baselineEquity) * 100),
    "risk-off": round((values["risk-off"] / baselineEquity) * 100)
  };
}

function classifyRegime(spyHistory: number[]): MarketRegime {
  if (spyHistory.length < 200) return "warmup";
  const latest = spyHistory.at(-1)!;
  const trendAverage = average(spyHistory.slice(-200));
  const momentumBase = spyHistory.at(-64)!;
  return latest > trendAverage && latest > momentumBase ? "risk-on" : "risk-off";
}

function annualReturns(
  equity: { date: string; value: number }[],
  initialBaseline: number
): Record<string, number> {
  const result: Record<string, number> = {};
  let baseline = initialBaseline;
  let activeYear = equity[0]!.date.slice(0, 4);
  let lastValue = baseline;
  for (const point of equity) {
    const year = point.date.slice(0, 4);
    if (year !== activeYear) {
      result[activeYear] = round((lastValue / baseline - 1) * 100);
      baseline = lastValue;
      activeYear = year;
    }
    lastValue = point.value;
  }
  result[activeYear] = round((lastValue / baseline - 1) * 100);
  return result;
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
  if (!Number.isInteger(config.rebalanceDelaySessions) || config.rebalanceDelaySessions < 0) {
    throw new Error("Rebalance delay must be a non-negative integer.");
  }
  if (!Number.isInteger(config.skipEveryNthRebalance) || config.skipEveryNthRebalance < 0) {
    throw new Error("Skipped-rebalance interval must be a non-negative integer.");
  }
  if (!Number.isFinite(config.cashAnnualYieldPct) || config.cashAnnualYieldPct < 0) {
    throw new Error("Cash annual yield must be a non-negative percentage.");
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
