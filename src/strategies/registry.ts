import { BuyAndHoldStrategy } from "./buy-and-hold-strategy.js";
import type { Strategy } from "./interfaces.js";
import { MeanReversionStrategy } from "./mean-reversion-strategy.js";
import { MomentumStrategy } from "./momentum-strategy.js";
import { MovingAverageCrossoverStrategy } from "./moving-average-crossover-strategy.js";
import { RsiStrategy } from "./rsi-strategy.js";
import { ScoredContextStrategy } from "./scored-context-strategy.js";
import { TrendFilteredMomentumStrategy } from "./trend-filtered-momentum-strategy.js";
import { VolatilityBreakoutStrategy } from "./volatility-breakout-strategy.js";

export type StrategyParams = Record<string, unknown>;

export type StrategyCategory =
  | "baseline"
  | "trend"
  | "momentum"
  | "mean-reversion"
  | "breakout"
  | "multi-factor";

export interface StrategyMetadata {
  id: string;
  name: string;
  description: string;
  category: StrategyCategory;
  defaultParams: StrategyParams;
  tags: string[];
}

export interface StrategyDefinition {
  id: string;
  name: string;
  description: string;
  category: StrategyCategory;
  defaultParams: StrategyParams;
  tags: string[];
  create(params?: StrategyParams): Strategy;
}

export class StrategyRegistry {
  private readonly definitions = new Map<string, StrategyDefinition>();

  register(definition: StrategyDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Strategy already registered: ${definition.id}`);
    }

    this.definitions.set(definition.id, definition);
  }

  create(id: string, params?: StrategyParams): Strategy {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new Error(`Unknown strategy: ${id}. Available: ${this.ids().join(", ")}`);
    }

    return definition.create(params);
  }

  metadata(id: string): StrategyMetadata {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new Error(`Unknown strategy: ${id}. Available: ${this.ids().join(", ")}`);
    }

    return toMetadata(definition);
  }

  metadataList(): StrategyMetadata[] {
    return this.ids().map((id) => this.metadata(id));
  }

  ids(): string[] {
    return [...this.definitions.keys()].sort();
  }
}

export function createDefaultStrategyRegistry(): StrategyRegistry {
  const registry = new StrategyRegistry();

  registry.register({
    id: "moving-average-crossover",
    name: "Moving Average Crossover",
    description: "Buys when short moving average is above long moving average; sells below it.",
    category: "trend",
    defaultParams: {
      shortWindow: 3,
      longWindow: 5,
      minConfidence: 0.01
    },
    tags: ["trend-following", "moving-average", "long-only"],
    create(params = {}) {
      return new MovingAverageCrossoverStrategy({
        shortWindow: readPositiveInteger(params, "shortWindow", 3),
        longWindow: readPositiveInteger(params, "longWindow", 5),
        minConfidence: readNonNegativeNumber(params, "minConfidence", 0.01)
      });
    }
  });

  registry.register({
    id: "buy-and-hold",
    name: "Buy and Hold",
    description: "Baseline strategy that buys once and holds the long position.",
    category: "baseline",
    defaultParams: {
      targetAllocationPct: 1
    },
    tags: ["baseline", "long-only"],
    create(params = {}) {
      return new BuyAndHoldStrategy({
        targetAllocationPct: readRatioNumber(params, "targetAllocationPct", 1)
      });
    }
  });

  registry.register({
    id: "momentum",
    name: "Momentum",
    description: "Buys positive rate-of-change and exits long positions on negative momentum.",
    category: "momentum",
    defaultParams: {
      lookbackWindow: 5,
      buyThresholdPct: 2,
      sellThresholdPct: 2
    },
    tags: ["momentum", "rate-of-change", "long-only"],
    create(params = {}) {
      return new MomentumStrategy({
        lookbackWindow: readPositiveInteger(params, "lookbackWindow", 5),
        buyThresholdPct: readNonNegativeNumber(params, "buyThresholdPct", 2),
        sellThresholdPct: readNonNegativeNumber(params, "sellThresholdPct", 2)
      });
    }
  });

  registry.register({
    id: "mean-reversion",
    name: "Mean Reversion",
    description: "Buys oversold z-score moves and exits after reversion.",
    category: "mean-reversion",
    defaultParams: {
      lookbackWindow: 10,
      entryZScore: 1.5,
      exitZScore: 0
    },
    tags: ["z-score", "oversold", "long-only"],
    create(params = {}) {
      return new MeanReversionStrategy({
        lookbackWindow: readPositiveInteger(params, "lookbackWindow", 10),
        entryZScore: readNonNegativeNumber(params, "entryZScore", 1.5),
        exitZScore: readNonNegativeNumber(params, "exitZScore", 0)
      });
    }
  });

  registry.register({
    id: "rsi-threshold",
    name: "RSI Threshold",
    description: "Buys oversold RSI and exits overbought long positions.",
    category: "mean-reversion",
    defaultParams: {
      rsiWindow: 14,
      oversoldThreshold: 30,
      overboughtThreshold: 70
    },
    tags: ["rsi", "oscillator", "long-only"],
    create(params = {}) {
      return new RsiStrategy({
        rsiWindow: readPositiveInteger(params, "rsiWindow", 14),
        oversoldThreshold: readNonNegativeNumber(params, "oversoldThreshold", 30),
        overboughtThreshold: readNonNegativeNumber(params, "overboughtThreshold", 70)
      });
    }
  });

  registry.register({
    id: "volatility-breakout",
    name: "Volatility Breakout",
    description: "Buys breakouts above recent highs and exits breakdowns below recent lows.",
    category: "breakout",
    defaultParams: {
      lookbackWindow: 20,
      breakoutPct: 1
    },
    tags: ["breakout", "volatility", "long-only"],
    create(params = {}) {
      return new VolatilityBreakoutStrategy({
        lookbackWindow: readPositiveInteger(params, "lookbackWindow", 20),
        breakoutPct: readNonNegativeNumber(params, "breakoutPct", 1)
      });
    }
  });

  registry.register({
    id: "trend-filtered-momentum",
    name: "Trend-Filtered Momentum",
    description: "Buys momentum only when price is above a longer trend average.",
    category: "momentum",
    defaultParams: {
      momentumWindow: 5,
      trendWindow: 20,
      momentumThresholdPct: 2
    },
    tags: ["momentum", "trend-filter", "long-only"],
    create(params = {}) {
      return new TrendFilteredMomentumStrategy({
        momentumWindow: readPositiveInteger(params, "momentumWindow", 5),
        trendWindow: readPositiveInteger(params, "trendWindow", 20),
        momentumThresholdPct: readNonNegativeNumber(params, "momentumThresholdPct", 2)
      });
    }
  });

  registry.register({
    id: "scored-context",
    name: "Scored Context",
    description:
      "Scores momentum, trend, volatility, and event sentiment for context-aware signals.",
    category: "multi-factor",
    defaultParams: {
      momentumWindow: 5,
      trendWindow: 20,
      buyScore: 3,
      sellScoreAbs: 2,
      highVolatilityThreshold: 0.03
    },
    tags: ["multi-factor", "momentum", "trend", "events"],
    create(params = {}) {
      return new ScoredContextStrategy({
        momentumWindow: readPositiveInteger(params, "momentumWindow", 5),
        trendWindow: readPositiveInteger(params, "trendWindow", 20),
        buyScore: readNonNegativeNumber(params, "buyScore", 3),
        sellScore: -readNonNegativeNumber(params, "sellScoreAbs", 2),
        highVolatilityThreshold: readNonNegativeNumber(params, "highVolatilityThreshold", 0.03)
      });
    }
  });

  return registry;
}

function toMetadata(definition: StrategyDefinition): StrategyMetadata {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    defaultParams: definition.defaultParams,
    tags: [...definition.tags]
  };
}

function readPositiveInteger(params: StrategyParams, key: string, fallback: number): number {
  const value = params[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Strategy parameter ${key} must be a positive integer.`);
  }

  return value;
}

function readNonNegativeNumber(params: StrategyParams, key: string, fallback: number): number {
  const value = params[key] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Strategy parameter ${key} must be a non-negative number.`);
  }

  return value;
}

function readRatioNumber(params: StrategyParams, key: string, fallback: number): number {
  const value = readNonNegativeNumber(params, key, fallback);
  if (value > 1) {
    throw new Error(`Strategy parameter ${key} must be between 0 and 1.`);
  }

  return value;
}
