import { describe, expect, it } from "vitest";
import type { StrategyContext } from "../src/data/interfaces.js";
import { createDefaultStrategyRegistry } from "../src/strategies/registry.js";

describe("StrategyRegistry", () => {
  it("creates registered strategies with params", async () => {
    const registry = createDefaultStrategyRegistry();

    const strategy = registry.create("moving-average-crossover", {
      shortWindow: 2,
      longWindow: 4,
      minConfidence: 0.02
    });

    expect(strategy.id).toBe("moving-average-crossover");
    expect(registry.ids()).toContain("buy-and-hold");
    expect(registry.ids()).toEqual([
      "buy-and-hold",
      "mean-reversion",
      "momentum",
      "moving-average-crossover",
      "rsi-threshold",
      "scored-context",
      "trend-filtered-momentum",
      "volatility-breakout"
    ]);
  });

  it("rejects unknown strategies", () => {
    const registry = createDefaultStrategyRegistry();

    expect(() => registry.create("not-real")).toThrow("Unknown strategy");
  });

  it("evaluates every default strategy against a basic context", async () => {
    const registry = createDefaultStrategyRegistry();
    const context = makeContext();

    for (const strategyId of registry.ids()) {
      const strategy = registry.create(strategyId, {
        shortWindow: 2,
        longWindow: 4,
        lookbackWindow: 4,
        rsiWindow: 3,
        momentumWindow: 3,
        trendWindow: 5
      });
      const signal = await strategy.evaluate(context);

      expect(signal.strategyId).toBe(strategyId);
      expect(signal.symbol).toBe("DEMO/USD");
      expect(["buy", "sell", "hold"]).toContain(signal.action);
      expect(signal.reason.length).toBeGreaterThan(0);
    }
  });
});

function makeContext(): StrategyContext {
  const closes = [100, 98, 99, 101, 104, 107, 109, 108, 111, 114];
  const candles = closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1]!;
    const timestamp = new Date(Date.UTC(2026, 0, index + 1));

    return {
      symbol: "DEMO/USD",
      timeframe: "1d" as const,
      openTime: timestamp,
      closeTime: timestamp,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1_000
    };
  });

  return {
    symbol: "DEMO/USD",
    candles,
    events: [],
    positions: [],
    features: {
      momentum: 0.14,
      volatility: 0.01,
      newsSentiment: 0
    },
    tick: {
      symbol: "DEMO/USD",
      last: 114,
      timestamp: candles.at(-1)!.closeTime
    },
    now: candles.at(-1)!.closeTime
  };
}
