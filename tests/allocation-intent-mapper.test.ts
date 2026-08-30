import { describe, expect, it } from "vitest";
import type { StrategyContext } from "../src/data/interfaces.js";
import type { StrategySignal } from "../src/strategies/interfaces.js";
import { AllocationIntentMapper } from "../src/strategies/allocation-intent-mapper.js";

describe("AllocationIntentMapper", () => {
  it("tops up to the target allocation without exceeding max notional per trade", () => {
    const mapper = new AllocationIntentMapper({
      accountEquity: 100_000,
      targetAllocationPct: 0.02,
      maxNotionalPerTrade: 500
    });

    expect(mapper.map(signal("buy"), context({ close: 100 }))).toMatchObject({
      symbol: "SPY",
      side: "buy",
      quantity: 5,
      limitPrice: 100
    });
  });

  it("does not buy when the symbol is already at or above target allocation", () => {
    const mapper = new AllocationIntentMapper({
      accountEquity: 100_000,
      targetAllocationPct: 0.02
    });

    expect(mapper.map(signal("buy"), context({ close: 100, quantity: 20 }))).toBeUndefined();
  });

  it("uses symbol-specific allocation targets when provided", () => {
    const mapper = new AllocationIntentMapper({
      accountEquity: 100_000,
      targetAllocationPct: 0.001,
      targetAllocationPctBySymbol: {
        SPY: 0.0025
      }
    });

    expect(mapper.map(signal("buy"), context({ close: 100 }))).toMatchObject({
      quantity: 2.5,
      limitPrice: 100
    });
  });

  it("skips dust orders below the configured minimum", () => {
    const mapper = new AllocationIntentMapper({
      accountEquity: 100_000,
      targetAllocationPct: 0.02,
      minNotionalPerTrade: 50
    });

    expect(mapper.map(signal("buy"), context({ close: 100, quantity: 19.75 }))).toBeUndefined();
  });

  it("limits sell exits to existing long exposure", () => {
    const mapper = new AllocationIntentMapper({
      accountEquity: 100_000,
      targetAllocationPct: 0.02,
      maxNotionalPerTrade: 500
    });

    expect(mapper.map(signal("sell"), context({ close: 100, quantity: 3 }))).toMatchObject({
      side: "sell",
      quantity: 3,
      limitPrice: 100
    });
  });

  it("rejects invalid allocation settings", () => {
    expect(
      () =>
        new AllocationIntentMapper({
          accountEquity: 100_000,
          targetAllocationPct: 1.5
        })
    ).toThrow("targetAllocationPct");
  });
});

function signal(action: StrategySignal["action"]): StrategySignal {
  return {
    strategyId: "allocation-test",
    symbol: "SPY",
    action,
    confidence: action === "hold" ? 0 : 1,
    reason: "test signal",
    createdAt: new Date("2026-06-19T14:30:00.000Z")
  };
}

function context({ close, quantity = 0 }: { close: number; quantity?: number }): StrategyContext {
  return {
    symbol: "SPY",
    candles: [
      {
        symbol: "SPY",
        timeframe: "1m",
        openTime: new Date("2026-06-19T14:29:00.000Z"),
        closeTime: new Date("2026-06-19T14:30:00.000Z"),
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1000
      }
    ],
    events: [],
    positions:
      quantity === 0
        ? []
        : [
            {
              symbol: "SPY",
              quantity,
              averageEntryPrice: close,
              markPrice: close,
              unrealizedPnl: 0,
              updatedAt: new Date("2026-06-19T14:30:00.000Z")
            }
          ],
    features: {},
    now: new Date("2026-06-19T14:30:00.000Z")
  };
}
