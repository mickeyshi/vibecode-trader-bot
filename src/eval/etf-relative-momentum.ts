import type { Candle } from "../core/types.js";

export interface EtfMomentumConfig {
  momentumWindow: number;
  trendWindow: number;
  volatilityWindow: number;
  targetAnnualVolatility: number;
  maxAssetWeight: number;
  maxGrossWeight: number;
  selectionCount: number;
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
  momentumWindow: 126,
  trendWindow: 200,
  volatilityWindow: 20,
  targetAnnualVolatility: 0.1,
  maxAssetWeight: 0.4,
  maxGrossWeight: 0.8,
  selectionCount: 2,
  transactionCostBps: 10
};

export function runEtfRelativeMomentum(
  candles: Candle[],
  config: EtfMomentumConfig = DEFAULT_ETF_MOMENTUM_CONFIG,
  startingEquity = 100_000
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
    strategy: summarize(strategy.equity, strategy.turnover, startingEquity),
    benchmark: summarize(benchmark.equity, benchmark.turnover, startingEquity),
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
): { equity: number[]; turnover: number; rebalanceCount: number } {
  let cash = startingEquity;
  let turnover = 0;
  let rebalanceCount = 0;
  let priorMonth = "";
  const shares = new Map<string, number>();
  const histories = new Map<string, number[]>();
  const equity: number[] = [];

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
          : selectTargets(histories, config);
      for (const symbol of new Set([...shares.keys(), ...targets.keys()])) {
        const price = prices.get(symbol);
        if (!price) continue;
        const desiredValue = currentEquity * (targets.get(symbol) ?? 0);
        const currentValue = (shares.get(symbol) ?? 0) * price;
        const tradedValue = Math.abs(desiredValue - currentValue);
        const cost = tradedValue * (config.transactionCostBps / 10_000);
        cash += currentValue - desiredValue - cost;
        shares.set(symbol, desiredValue / price);
        turnover += tradedValue / currentEquity;
      }
      priorMonth = month;
      rebalanceCount += 1;
    }

    const closePrices = new Map(bars.map((bar) => [bar.symbol, bar.close]));
    equity.push(portfolioValue(cash, shares, closePrices));
    for (const bar of bars) {
      const history = histories.get(bar.symbol) ?? [];
      history.push(bar.close);
      histories.set(bar.symbol, history);
    }
  }
  return { equity, turnover, rebalanceCount };
}

function selectTargets(
  histories: Map<string, number[]>,
  config: EtfMomentumConfig
): Map<string, number> {
  const ranked = [...histories.entries()]
    .map(([symbol, closes]) => ({ symbol, ...score(closes, config) }))
    .filter((candidate) => candidate.eligible)
    .sort((left, right) => right.score - left.score)
    .slice(0, config.selectionCount);
  const targets = new Map<string, number>();
  let gross = 0;
  for (const candidate of ranked) {
    const rawWeight = Math.min(
      config.maxAssetWeight,
      config.targetAnnualVolatility / candidate.annualizedVolatility / config.selectionCount
    );
    const weight = Math.max(0, Math.min(rawWeight, config.maxGrossWeight - gross));
    if (weight > 0) targets.set(candidate.symbol, weight);
    gross += weight;
  }
  return targets;
}

function score(
  closes: number[],
  config: EtfMomentumConfig
): { eligible: boolean; score: number; annualizedVolatility: number } {
  const required = Math.max(config.trendWindow, config.momentumWindow, config.volatilityWindow + 1);
  if (closes.length < required) return { eligible: false, score: 0, annualizedVolatility: 1 };
  const latest = closes.at(-1)!;
  const trend = average(closes.slice(-config.trendWindow));
  const momentum = latest / closes.at(-config.momentumWindow)! - 1;
  const returns = closes
    .slice(-(config.volatilityWindow + 1))
    .slice(1)
    .map((value, index) => Math.log(value / closes.slice(-(config.volatilityWindow + 1))[index]!));
  const annualizedVolatility = standardDeviation(returns) * Math.sqrt(252);
  return {
    eligible: latest > trend && momentum > 0 && annualizedVolatility > 0,
    score: momentum / Math.max(annualizedVolatility, 0.01),
    annualizedVolatility
  };
}

function summarize(equity: number[], turnover: number, startingEquity: number): PerformanceSummary {
  const endingEquity = equity.at(-1)!;
  const dailyReturns = equity.slice(1).map((value, index) => value / equity[index]! - 1);
  const years = Math.max(equity.length / 252, 1 / 252);
  const annualizedVolatility = standardDeviation(dailyReturns) * Math.sqrt(252);
  const annualizedReturn = Math.pow(endingEquity / startingEquity, 1 / years) - 1;
  let peak = startingEquity;
  let drawdown = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    drawdown = Math.max(drawdown, (peak - value) / peak);
  }
  return {
    endingEquity: round(endingEquity),
    totalReturnPct: round((endingEquity / startingEquity - 1) * 100),
    annualizedReturnPct: round(annualizedReturn * 100),
    annualizedVolatilityPct: round(annualizedVolatility * 100),
    sharpeRatio: round(annualizedVolatility === 0 ? 0 : annualizedReturn / annualizedVolatility),
    maxDrawdownPct: round(drawdown * 100),
    turnover: round(turnover)
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
