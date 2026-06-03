import { describe, expect, it } from "vitest";
import type { StrategyContext } from "../src/data/interfaces.js";
import { SimpleBacktester } from "../src/eval/simple-backtester.js";
import type { SignalToIntentMapper, StrategySignal } from "../src/strategies/interfaces.js";
import { MovingAverageCrossoverStrategy } from "../src/strategies/moving-average-crossover-strategy.js";
import { makeCandles } from "./fixtures.js";

describe("SimpleBacktester", () => {
  it("runs candles through strategy, risk, paper execution, and reporting", async () => {
    const strategy = new MovingAverageCrossoverStrategy({
      shortWindow: 2,
      longWindow: 4,
      minConfidence: 0.01
    });
    const backtester = new SimpleBacktester({ strategy });

    const report = await backtester.run({
      strategyId: strategy.id,
      symbols: ["DEMO/USD"],
      candles: makeCandles([100, 99, 100, 102, 104, 106, 108]),
      startingEquity: 10_000,
      feeRate: 0.001,
      slippageBps: 5
    });

    expect(report.strategyId).toBe(strategy.id);
    expect(report.orders.length).toBeGreaterThan(0);
    expect(report.fills.length).toBe(report.orders.length);
    expect(report.riskRejections.length).toBeGreaterThanOrEqual(0);
    expect(report.equityCurve.length).toBeGreaterThan(1);
    expect(report.metrics.totalFees).toBeGreaterThan(0);
    expect(report.metrics.endingCash).toBeGreaterThanOrEqual(0);
    expect(report.metrics.finalGrossExposure).toBeGreaterThanOrEqual(0);
    expect(report.dataQualityWarnings).toHaveLength(0);
    expect(report.endingEquity).toBeGreaterThan(0);
    expect(report.assumptions).toContain("Orders fill immediately at the latest candle close.");
  });

  it("reports large candle gaps as data quality warnings", async () => {
    const strategy = new MovingAverageCrossoverStrategy({
      shortWindow: 2,
      longWindow: 4,
      minConfidence: 0.01
    });
    const backtester = new SimpleBacktester({ strategy });
    const candles = makeCandles([100, 101, 102, 103]);
    const gappedCandles = [
      candles[0]!,
      candles[1]!,
      {
        ...candles[2]!,
        openTime: new Date("2026-01-10T09:30:00.000Z"),
        closeTime: new Date("2026-01-10T09:31:00.000Z")
      },
      {
        ...candles[3]!,
        openTime: new Date("2026-01-10T09:31:00.000Z"),
        closeTime: new Date("2026-01-10T09:32:00.000Z")
      }
    ];

    const report = await backtester.run({
      strategyId: strategy.id,
      symbols: ["DEMO/USD"],
      candles: gappedCandles,
      startingEquity: 10_000,
      feeRate: 0.001,
      slippageBps: 5,
      maxDataGapDays: 1
    });

    expect(report.dataQualityWarnings).toHaveLength(1);
    expect(report.dataQualityWarnings[0]?.type).toBe("missing-data-gap");
    expect(report.dataQualityWarnings[0]?.calendar).toBe("weekday");
    expect(report.dataQualityWarnings[0]?.missingSessionCount).toBeGreaterThan(0);
  });

  it("does not flag weekend gaps for weekday market calendars", async () => {
    const strategy = new MovingAverageCrossoverStrategy({
      shortWindow: 2,
      longWindow: 4,
      minConfidence: 0.01
    });
    const backtester = new SimpleBacktester({ strategy });
    const candles = makeCandles([100, 101]);
    const friday = {
      ...candles[0]!,
      openTime: new Date("2026-01-02T00:00:00.000Z"),
      closeTime: new Date("2026-01-02T00:00:00.000Z")
    };
    const monday = {
      ...candles[1]!,
      openTime: new Date("2026-01-05T00:00:00.000Z"),
      closeTime: new Date("2026-01-05T00:00:00.000Z")
    };

    const report = await backtester.run({
      strategyId: strategy.id,
      symbols: ["DEMO/USD"],
      candles: [friday, monday],
      startingEquity: 10_000,
      feeRate: 0,
      slippageBps: 0,
      maxDataGapDays: 1,
      marketCalendar: "weekday"
    });

    expect(report.dataQualityWarnings).toHaveLength(0);
  });

  it("flags missing weekend sessions for crypto calendars", async () => {
    const strategy = new MovingAverageCrossoverStrategy({
      shortWindow: 2,
      longWindow: 4,
      minConfidence: 0.01
    });
    const backtester = new SimpleBacktester({ strategy });
    const candles = makeCandles([100, 101]);
    const friday = {
      ...candles[0]!,
      openTime: new Date("2026-01-02T00:00:00.000Z"),
      closeTime: new Date("2026-01-02T00:00:00.000Z")
    };
    const monday = {
      ...candles[1]!,
      openTime: new Date("2026-01-05T00:00:00.000Z"),
      closeTime: new Date("2026-01-05T00:00:00.000Z")
    };

    const report = await backtester.run({
      strategyId: strategy.id,
      symbols: ["DEMO/USD"],
      candles: [friday, monday],
      startingEquity: 10_000,
      feeRate: 0,
      slippageBps: 0,
      maxDataGapDays: 1,
      marketCalendar: "crypto-24-7"
    });

    expect(report.dataQualityWarnings).toHaveLength(1);
    expect(report.dataQualityWarnings[0]?.missingSessionCount).toBe(2);
  });

  it("excludes configured market holidays from gap warnings", async () => {
    const strategy = new MovingAverageCrossoverStrategy({
      shortWindow: 2,
      longWindow: 4,
      minConfidence: 0.01
    });
    const backtester = new SimpleBacktester({ strategy });
    const candles = makeCandles([100, 101]);
    const beforeHoliday = {
      ...candles[0]!,
      openTime: new Date("2026-01-01T00:00:00.000Z"),
      closeTime: new Date("2026-01-01T00:00:00.000Z")
    };
    const afterHoliday = {
      ...candles[1]!,
      openTime: new Date("2026-01-03T00:00:00.000Z"),
      closeTime: new Date("2026-01-03T00:00:00.000Z")
    };

    const report = await backtester.run({
      strategyId: strategy.id,
      symbols: ["DEMO/USD"],
      candles: [beforeHoliday, afterHoliday],
      startingEquity: 10_000,
      feeRate: 0,
      slippageBps: 0,
      maxDataGapDays: 1,
      marketCalendar: "weekday",
      marketHolidays: ["2026-01-02"]
    });

    expect(report.dataQualityWarnings).toHaveLength(0);
  });

  it("reports closed-trade win and loss metrics from fills", async () => {
    let nextAction: StrategySignal["action"] = "buy";
    const strategy = {
      id: "scripted-test-strategy",
      async evaluate(context: StrategyContext): Promise<StrategySignal> {
        const action = nextAction;
        nextAction = action === "buy" ? "sell" : "hold";

        return {
          strategyId: this.id,
          symbol: context.symbol,
          action,
          confidence: 1,
          reason: `scripted ${action}`,
          createdAt: context.now
        };
      }
    };
    const mapper: SignalToIntentMapper = {
      map(signal, context) {
        if (signal.action === "hold" || !context.tick) {
          return undefined;
        }

        return {
          symbol: signal.symbol,
          side: signal.action,
          type: "market",
          quantity: 1,
          limitPrice: context.tick.last,
          reason: signal.reason,
          strategyId: signal.strategyId
        };
      }
    };
    const backtester = new SimpleBacktester({ strategy, mapper });

    const report = await backtester.run({
      strategyId: strategy.id,
      symbols: ["DEMO/USD"],
      candles: makeCandles([100, 110, 120]),
      startingEquity: 10_000,
      feeRate: 0,
      slippageBps: 0
    });

    expect(report.metrics.closedTradeCount).toBe(1);
    expect(report.trades).toHaveLength(1);
    expect(report.trades[0]?.symbol).toBe("DEMO/USD");
    expect(report.trades[0]?.pnl).toBe(10);
    expect(report.trades[0]?.returnPct).toBe(10);
    expect(report.metrics.winningTradeCount).toBe(1);
    expect(report.metrics.losingTradeCount).toBe(0);
    expect(report.metrics.winRatePct).toBe(100);
    expect(report.metrics.grossProfit).toBe(10);
    expect(report.metrics.profitFactor).toBeNull();
  });
});
