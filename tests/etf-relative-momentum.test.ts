import { describe, expect, it } from "vitest";
import type { Candle } from "../src/core/types.js";
import {
  DEFAULT_ETF_MOMENTUM_CONFIG,
  runEtfRelativeMomentum
} from "../src/eval/etf-relative-momentum.js";

describe("ETF relative momentum research simulation", () => {
  it("runs a prior-close monthly rotation without leverage", () => {
    const candles: Candle[] = [];
    for (let day = 0; day < 320; day += 1) {
      const time = new Date(Date.UTC(2024, 0, 1 + day));
      for (const [symbol, slope] of [
        ["SPY", 0.001],
        ["QQQ", 0.002],
        ["IEF", -0.0002]
      ] as const) {
        const close = 100 * (1 + slope) ** day;
        candles.push({
          symbol,
          timeframe: "1d",
          openTime: time,
          closeTime: time,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1_000_000
        });
      }
    }
    const result = runEtfRelativeMomentum(candles, undefined, 100_000);
    expect(result.rebalanceCount).toBeGreaterThan(5);
    expect(result.strategy.endingEquity).toBeGreaterThan(100_000);
    expect(result.strategy.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(Object.keys(result.strategy.annualReturnsPct)).toEqual(["2024"]);
    expect(Object.keys(result.strategy.symbolContributionPct).length).toBeGreaterThan(0);
    expect(
      Object.values(result.strategy.symbolContributionPct).reduce((sum, value) => sum + value, 0)
    ).toBeCloseTo(result.strategy.totalReturnPct, 3);
  });

  it("refuses insufficient history", () => {
    expect(() => runEtfRelativeMomentum([])).toThrow("Not enough daily candles");
  });

  it("models delayed monthly rebalances without changing the observation window", () => {
    const candles = trendingCandles(420);
    const immediate = runEtfRelativeMomentum(candles);
    const delayed = runEtfRelativeMomentum(candles, {
      ...DEFAULT_ETF_MOMENTUM_CONFIG,
      rebalanceDelaySessions: 5
    });
    expect(delayed.firstDate).toBe(immediate.firstDate);
    expect(delayed.lastDate).toBe(immediate.lastDate);
    expect(delayed.strategy.endingEquity).not.toBe(immediate.strategy.endingEquity);
  });

  it("rejects a negative or fractional rebalance delay", () => {
    const candles = trendingCandles(320);
    for (const rebalanceDelaySessions of [-1, 1.5]) {
      expect(() =>
        runEtfRelativeMomentum(candles, {
          ...DEFAULT_ETF_MOMENTUM_CONFIG,
          rebalanceDelaySessions
        })
      ).toThrow("Rebalance delay");
    }
  });

  it("tracks deterministically missed rebalances", () => {
    const result = runEtfRelativeMomentum(trendingCandles(420), {
      ...DEFAULT_ETF_MOMENTUM_CONFIG,
      skipEveryNthRebalance: 3
    });
    expect(result.missedRebalanceCount).toBeGreaterThan(0);
    expect(result.rebalanceCount).toBeGreaterThan(result.missedRebalanceCount);
  });

  it("attributes returns to calendar years using the prior year-end baseline", () => {
    const result = runEtfRelativeMomentum(trendingCandles(800), {
      ...DEFAULT_ETF_MOMENTUM_CONFIG,
      momentumWindow: 20,
      trendWindow: 30
    });
    expect(Object.keys(result.strategy.annualReturnsPct)).toEqual(["2022", "2023", "2024"]);
    expect(Object.values(result.strategy.annualReturnsPct).every(Number.isFinite)).toBe(true);
    expect(Object.keys(result.benchmark.annualReturnsPct)).toEqual(["2022", "2023", "2024"]);
  });

  it("rejects a negative or fractional skipped-rebalance interval", () => {
    const candles = trendingCandles(320);
    for (const skipEveryNthRebalance of [-1, 1.5]) {
      expect(() =>
        runEtfRelativeMomentum(candles, {
          ...DEFAULT_ETF_MOMENTUM_CONFIG,
          skipEveryNthRebalance
        })
      ).toThrow("Skipped-rebalance interval");
    }
  });
});

function trendingCandles(days: number): Candle[] {
  const candles: Candle[] = [];
  for (let day = 0; day < days; day += 1) {
    const time = new Date(Date.UTC(2022, 0, 1 + day));
    for (const [symbol, slope] of [
      ["SPY", 0.001],
      ["QQQ", day % 40 < 20 ? 0.002 : -0.0005],
      ["IEF", 0.0001]
    ] as const) {
      const close = 100 * (1 + slope) ** day;
      candles.push({
        symbol,
        timeframe: "1d",
        openTime: time,
        closeTime: time,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1_000_000
      });
    }
  }
  return candles;
}
