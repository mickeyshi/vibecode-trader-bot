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

export interface StrategyDefinition {
  id: string;
  description: string;
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

  ids(): string[] {
    return [...this.definitions.keys()].sort();
  }
}

export function createDefaultStrategyRegistry(): StrategyRegistry {
  const registry = new StrategyRegistry();

  registry.register({
    id: "moving-average-crossover",
    description: "Buys when short moving average is above long moving average; sells below it.",
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
    description: "Baseline strategy that buys once and holds the long position.",
    create(params = {}) {
      return new BuyAndHoldStrategy({
        targetAllocationPct: readRatioNumber(params, "targetAllocationPct", 1)
      });
    }
  });

  registry.register({
    id: "momentum",
    description: "Buys positive rate-of-change and exits long positions on negative momentum.",
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
    description: "Buys oversold z-score moves and exits after reversion.",
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
    description: "Buys oversold RSI and exits overbought long positions.",
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
    description: "Buys breakouts above recent highs and exits breakdowns below recent lows.",
    create(params = {}) {
      return new VolatilityBreakoutStrategy({
        lookbackWindow: readPositiveInteger(params, "lookbackWindow", 20),
        breakoutPct: readNonNegativeNumber(params, "breakoutPct", 1)
      });
    }
  });

  registry.register({
    id: "trend-filtered-momentum",
    description: "Buys momentum only when price is above a longer trend average.",
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
    description:
      "Scores momentum, trend, volatility, and event sentiment for context-aware signals.",
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
