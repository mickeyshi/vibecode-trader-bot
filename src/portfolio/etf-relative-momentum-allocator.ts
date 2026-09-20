import type {
  PortfolioAllocationPlan,
  PortfolioAllocationRequest,
  PortfolioAllocator
} from "./portfolio-allocator.js";

export interface EtfMomentumAllocationConfig {
  momentumWindow: number;
  trendWindow: number;
  volatilityWindow: number;
  targetAnnualVolatility: number;
  maxAssetWeight: number;
  maxGrossWeight: number;
  selectionCount: number;
  blockEventImportanceAtOrAbove: number;
  eventLookbackMs: number;
}

export const DEFAULT_ETF_MOMENTUM_ALLOCATION_CONFIG: EtfMomentumAllocationConfig = {
  momentumWindow: 126,
  trendWindow: 200,
  volatilityWindow: 20,
  targetAnnualVolatility: 0.1,
  maxAssetWeight: 0.4,
  maxGrossWeight: 0.8,
  selectionCount: 2,
  blockEventImportanceAtOrAbove: 8,
  eventLookbackMs: 3 * 24 * 60 * 60 * 1000
};

export class EtfRelativeMomentumAllocator implements PortfolioAllocator {
  constructor(private readonly config = DEFAULT_ETF_MOMENTUM_ALLOCATION_CONFIG) {
    validateConfig(config);
  }

  allocate(request: PortfolioAllocationRequest): PortfolioAllocationPlan {
    const events = request.recentEvents ?? [];
    if (events.length > 0 && !request.asOf) {
      throw new Error("Allocation events require an explicit asOf timestamp.");
    }
    const asOf = request.asOf?.getTime();
    const uniqueEvents = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      const timestamp = event.timestamp.getTime();
      if (
        asOf === undefined ||
        !Number.isFinite(timestamp) ||
        timestamp > asOf ||
        timestamp < asOf - this.config.eventLookbackMs
      ) {
        continue;
      }
      const key = [
        event.source.trim().toLowerCase(),
        event.symbol?.trim().toUpperCase() ?? "MARKET",
        event.headline.trim().toLowerCase().replace(/\s+/g, " ")
      ].join("|");
      const existing = uniqueEvents.get(key);
      if (!existing || existing.timestamp < event.timestamp) uniqueEvents.set(key, event);
    }
    const blockedSymbols = new Set(
      [...uniqueEvents.values()]
        .filter(
          (event) =>
            event.symbol &&
            event.importance >= this.config.blockEventImportanceAtOrAbove &&
            event.sentiment === "negative"
        )
        .map((event) => event.symbol!.toUpperCase())
    );
    const ranked = [...request.closeHistoryBySymbol.entries()]
      .map(([symbol, closes]) => ({ symbol: symbol.toUpperCase(), ...score(closes, this.config) }))
      .filter((candidate) => candidate.eligible && !blockedSymbols.has(candidate.symbol))
      .sort((left, right) => right.score - left.score)
      .slice(0, this.config.selectionCount);
    let grossWeight = 0;
    const targets = ranked.flatMap((candidate) => {
      const rawWeight = Math.min(
        this.config.maxAssetWeight,
        this.config.targetAnnualVolatility /
          candidate.annualizedVolatility /
          this.config.selectionCount
      );
      const targetWeight = Math.max(
        0,
        Math.min(rawWeight, this.config.maxGrossWeight - grossWeight)
      );
      grossWeight += targetWeight;
      return targetWeight === 0
        ? []
        : [
            {
              symbol: candidate.symbol,
              targetWeight,
              score: candidate.score,
              annualizedVolatility: candidate.annualizedVolatility,
              reason: `Positive ${this.config.momentumWindow}-session momentum, above ${this.config.trendWindow}-session trend, volatility targeted.`
            }
          ];
    });
    return {
      targets,
      grossWeight,
      cashWeight: 1 - grossWeight,
      blockedSymbols: [...blockedSymbols].sort()
    };
  }
}

function score(closes: readonly number[], config: EtfMomentumAllocationConfig) {
  const required = Math.max(config.trendWindow, config.momentumWindow, config.volatilityWindow + 1);
  if (closes.length < required) return { eligible: false, score: 0, annualizedVolatility: 1 };
  const latest = closes.at(-1)!;
  const trendValues = closes.slice(-config.trendWindow);
  const trend = average(trendValues);
  const momentum = latest / closes.at(-config.momentumWindow)! - 1;
  const volatilityValues = closes.slice(-(config.volatilityWindow + 1));
  const returns = volatilityValues
    .slice(1)
    .map((value, index) => Math.log(value / volatilityValues[index]!));
  const annualizedVolatility = standardDeviation(returns) * Math.sqrt(252);
  return {
    eligible: latest > trend && momentum > 0 && annualizedVolatility > 0,
    score: momentum / Math.max(annualizedVolatility, 0.01),
    annualizedVolatility
  };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function validateConfig(config: EtfMomentumAllocationConfig): void {
  for (const value of [
    config.momentumWindow,
    config.trendWindow,
    config.volatilityWindow,
    config.selectionCount
  ]) {
    if (!Number.isInteger(value) || value <= 0)
      throw new Error("Allocator windows and selection count must be positive integers.");
  }
  if (
    config.targetAnnualVolatility <= 0 ||
    config.maxAssetWeight <= 0 ||
    config.maxGrossWeight <= 0 ||
    config.maxGrossWeight > 1
  ) {
    throw new Error(
      "Allocator volatility and weights must be positive; gross weight cannot exceed one."
    );
  }
  if (config.blockEventImportanceAtOrAbove < 0) {
    throw new Error("Allocator event importance threshold must be non-negative.");
  }
  if (!Number.isFinite(config.eventLookbackMs) || config.eventLookbackMs <= 0) {
    throw new Error("Allocator event lookback must be positive.");
  }
}
