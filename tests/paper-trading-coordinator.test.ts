import { describe, expect, it } from "vitest";
import type { Candle, Order, OrderIntent, Position } from "../src/core/types.js";
import type { LiveOpsSnapshotConfig } from "../src/dashboard/live-ops-snapshot.js";
import { regularUsEquitiesMarketSession } from "../src/execution/market-session.js";
import {
  runPaperTradingCoordinator,
  type PaperTradingBroker,
  type PaperTradingMarketData
} from "../src/execution/paper-trading-coordinator.js";
import type {
  PaperTradingCoordinatorState,
  PaperTradingStateStore,
  SubmissionJournal,
  SubmissionJournalEntry
} from "../src/execution/paper-trading-state.js";
import type { ExecutionResult } from "../src/execution/interfaces.js";
import type { AccountSnapshot } from "../src/portfolio/interfaces.js";
import { BasicRiskEngine } from "../src/risk/basic-risk-engine.js";
import { AllocationIntentMapper } from "../src/strategies/allocation-intent-mapper.js";
import { BuyAndHoldStrategy } from "../src/strategies/buy-and-hold-strategy.js";
import { FixedNotionalIntentMapper } from "../src/strategies/fixed-notional-intent-mapper.js";
import { MovingAverageCrossoverStrategy } from "../src/strategies/moving-average-crossover-strategy.js";

describe("paper trading coordinator", () => {
  it("runs bounded paper cycles across symbols and avoids duplicate buy-and-hold entries", async () => {
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["spy", "aapl", "SPY"],
      iterations: 2,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({
        SPY: 500,
        AAPL: 250
      }),
      snapshotConfig: snapshotConfig(),
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.cycles).toHaveLength(4);
    expect(result.executions.map((execution) => execution.order.intent.symbol)).toEqual([
      "SPY",
      "AAPL"
    ]);
    expect(broker.seen.map((intent) => [intent.symbol, intent.side, intent.quantity])).toEqual([
      ["SPY", "buy", 0.05],
      ["AAPL", "buy", 0.1]
    ]);
    expect(result.cycles.slice(2).map((cycle) => cycle.skippedReason)).toEqual([
      "Strategy did not produce an order intent.",
      "Strategy did not produce an order intent."
    ]);
    expect(result.liveOps.positions.map((position) => position.symbol).sort()).toEqual([
      "AAPL",
      "SPY"
    ]);
    expect(result.liveOps.orders).toHaveLength(2);
    expect(result.liveOps.account.grossExposure).toBe(50);
    expect(result.runSummary).toEqual({
      dryRun: false,
      submittedNotional: 50,
      maxNotionalPerRun: null,
      executionCount: 2,
      maxExecutionsPerRun: null,
      skippedCount: 2
    });
    expect(result.liveOps.paperRun).toEqual(result.runSummary);
    expect(result.liveOps.paperCycles?.map((cycle) => [cycle.symbol, cycle.status])).toEqual([
      ["SPY", "submitted"],
      ["AAPL", "submitted"],
      ["SPY", "skipped"],
      ["AAPL", "skipped"]
    ]);
  });

  it("can size paper entries by per-symbol allocation target", async () => {
    const broker = new InMemoryPaperBroker();
    await runPaperTradingCoordinator({
      symbols: ["SPY", "AAPL"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new AllocationIntentMapper({
        accountEquity: 100_000,
        targetAllocationPct: 0.001,
        targetAllocationPctBySymbol: {
          SPY: 0.0025,
          AAPL: 0.0015
        },
        maxNotionalPerTrade: 200
      }),
      riskEngineFactory: () =>
        new BasicRiskEngine({
          maxOrderNotional: 200,
          maxPositionNotional: 250,
          maxDailyLossPct: 0.01,
          blockHighImpactEventsAtOrAbove: 1,
          maxGrossLeverage: 0.25
        }),
      broker,
      marketData: new StaticMarketData({ SPY: 500, AAPL: 250 }),
      snapshotConfig: snapshotConfig(),
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(broker.seen.map((intent) => [intent.symbol, intent.quantity])).toEqual([
      ["SPY", 0.4],
      ["AAPL", 0.6]
    ]);
  });

  it("can submit strategy-driven sell exits for existing paper positions", async () => {
    const broker = new InMemoryPaperBroker();
    broker.seedPosition({
      symbol: "SPY",
      quantity: 0.5,
      averageEntryPrice: 100,
      markPrice: 90,
      unrealizedPnl: -5,
      updatedAt: new Date("2026-06-19T14:30:00.000Z")
    });
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 3,
      intervalMs: 0,
      strategy: new MovingAverageCrossoverStrategy({
        shortWindow: 1,
        longWindow: 3,
        minConfidence: 0.01
      }),
      intentMapper: new AllocationIntentMapper({
        accountEquity: 100_000,
        targetAllocationPct: 0.001,
        maxNotionalPerTrade: 100
      }),
      riskEngineFactory: () =>
        new BasicRiskEngine({
          maxOrderNotional: 100,
          maxPositionNotional: 250,
          maxDailyLossPct: 0.01,
          blockHighImpactEventsAtOrAbove: 1,
          maxGrossLeverage: 0.25
        }),
      broker,
      marketData: new SequencedMarketData({
        SPY: [
          { close: 100, closeTime: "2026-06-19T14:29:00.000Z" },
          { close: 95, closeTime: "2026-06-19T14:30:00.000Z" },
          { close: 90, closeTime: "2026-06-19T14:31:00.000Z" }
        ]
      }),
      snapshotConfig: snapshotConfig(),
      now: new Date("2026-06-19T14:31:30.000Z")
    });

    expect(result.executions).toHaveLength(1);
    expect(result.executions[0]?.order.intent).toMatchObject({
      symbol: "SPY",
      side: "sell",
      quantity: 0.5,
      limitPrice: 90,
      strategyId: "moving-average-crossover"
    });
    expect(result.cycles.at(-1)?.signal.reason).toBe("Short MA 90.0000 below long MA 95.0000.");
    expect(broker.seen.map((intent) => [intent.symbol, intent.side, intent.quantity])).toEqual([
      ["SPY", "sell", 0.5]
    ]);
    expect(await broker.getOpenPositions()).toEqual([]);
    expect(result.runSummary).toMatchObject({
      dryRun: false,
      submittedNotional: 45,
      executionCount: 1
    });
  });

  it("can submit multiple strategy-driven entries and exits in one paper session", async () => {
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 5,
      intervalMs: 0,
      strategy: new MovingAverageCrossoverStrategy({
        shortWindow: 1,
        longWindow: 3,
        minConfidence: 0.01
      }),
      intentMapper: new AllocationIntentMapper({
        accountEquity: 100_000,
        targetAllocationPct: 0.001,
        maxNotionalPerTrade: 50
      }),
      riskEngineFactory: () =>
        new BasicRiskEngine({
          maxOrderNotional: 100,
          maxPositionNotional: 250,
          maxDailyLossPct: 0.01,
          blockHighImpactEventsAtOrAbove: 1,
          maxGrossLeverage: 0.25
        }),
      broker,
      marketData: new SequencedMarketData({
        SPY: [
          { close: 100, closeTime: "2026-06-19T14:27:00.000Z" },
          { close: 105, closeTime: "2026-06-19T14:28:00.000Z" },
          { close: 110, closeTime: "2026-06-19T14:29:00.000Z" },
          { close: 80, closeTime: "2026-06-19T14:30:00.000Z" },
          { close: 120, closeTime: "2026-06-19T14:31:00.000Z" }
        ]
      }),
      snapshotConfig: snapshotConfig(),
      now: new Date("2026-06-19T14:31:30.000Z")
    });

    expect(result.executions.map((execution) => execution.order.intent.side)).toEqual([
      "buy",
      "sell",
      "buy"
    ]);
    expect(broker.seen.map((intent) => [intent.symbol, intent.side])).toEqual([
      ["SPY", "buy"],
      ["SPY", "sell"],
      ["SPY", "buy"]
    ]);
    expect(result.liveOps.paperCycles?.map((cycle) => [cycle.action, cycle.status])).toEqual([
      ["hold", "skipped"],
      ["hold", "skipped"],
      ["buy", "submitted"],
      ["sell", "submitted"],
      ["buy", "submitted"]
    ]);
    expect(result.runSummary.executionCount).toBe(3);
    expect(result.runSummary.submittedNotional).toBeCloseTo(136.36, 2);
    expect((await broker.getOpenPositions())[0]).toMatchObject({
      symbol: "SPY",
      quantity: 50 / 120,
      markPrice: 120
    });
  });

  it("accumulates candle history across iterations for multi-candle strategies", async () => {
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 3,
      intervalMs: 0,
      strategy: new MovingAverageCrossoverStrategy({
        shortWindow: 1,
        longWindow: 3,
        minConfidence: 0.01
      }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new SequencedMarketData({
        SPY: [
          { close: 100, closeTime: "2026-06-19T14:29:00.000Z" },
          { close: 105, closeTime: "2026-06-19T14:30:00.000Z" },
          { close: 110, closeTime: "2026-06-19T14:31:00.000Z" }
        ]
      }),
      snapshotConfig: snapshotConfig(),
      now: new Date("2026-06-19T14:31:30.000Z")
    });

    expect(result.cycles.map((cycle) => cycle.signal.reason)).toEqual([
      "Not enough candles.",
      "Not enough candles.",
      "Short MA 110.0000 above long MA 105.0000."
    ]);
    expect(result.executions.map((execution) => execution.order.intent.symbol)).toEqual(["SPY"]);
    expect(broker.seen).toHaveLength(1);
  });

  it("deduplicates repeated latest-bar timestamps in coordinator candle history", async () => {
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 3,
      intervalMs: 0,
      strategy: new MovingAverageCrossoverStrategy({
        shortWindow: 1,
        longWindow: 2,
        minConfidence: 0.01
      }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new SequencedMarketData({
        SPY: [
          { close: 100, closeTime: "2026-06-19T14:30:00.000Z" },
          { close: 105, closeTime: "2026-06-19T14:30:00.000Z" },
          { close: 110, closeTime: "2026-06-19T14:31:00.000Z" }
        ]
      }),
      snapshotConfig: snapshotConfig(),
      now: new Date("2026-06-19T14:31:30.000Z")
    });

    expect(result.cycles.map((cycle) => cycle.signal.reason)).toEqual([
      "Not enough candles.",
      "Not enough candles.",
      "Short MA 110.0000 above long MA 107.5000."
    ]);
    expect(result.executions).toHaveLength(1);
  });

  it("hydrates persisted candle history before evaluating multi-candle strategies", async () => {
    const stateStore = new MemoryStateStore({
      version: 1,
      updatedAt: "2026-06-19T14:30:00.000Z",
      runCount: 1,
      lastRun: {
        startedAt: "2026-06-19T14:29:00.000Z",
        completedAt: "2026-06-19T14:30:00.000Z",
        symbols: ["SPY"],
        cycleCount: 2,
        executionCount: 0,
        skippedCount: 2
      },
      pendingOrders: [],
      candleHistory: [
        stateCandle("SPY", 100, "2026-06-19T14:29:00.000Z"),
        stateCandle("SPY", 105, "2026-06-19T14:30:00.000Z")
      ]
    });
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new MovingAverageCrossoverStrategy({
        shortWindow: 1,
        longWindow: 3,
        minConfidence: 0.01
      }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new SequencedMarketData({
        SPY: [{ close: 110, closeTime: "2026-06-19T14:31:00.000Z" }]
      }),
      snapshotConfig: snapshotConfig(),
      stateStore,
      maxHistoryCandles: 3,
      now: new Date("2026-06-19T14:31:30.000Z")
    });

    expect(result.executions.map((execution) => execution.order.intent.symbol)).toEqual(["SPY"]);
    expect(result.cycles[0]?.signal.reason).toBe("Short MA 110.0000 above long MA 105.0000.");
    expect(stateStore.state?.candleHistory?.map((candle) => [candle.symbol, candle.close])).toEqual(
      [
        ["SPY", 100],
        ["SPY", 105],
        ["SPY", 110]
      ]
    );
  });

  it("bootstraps multi-candle strategies from read-only historical bars", async () => {
    const broker = new InMemoryPaperBroker();
    const marketData = new BootstrapMarketData();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new MovingAverageCrossoverStrategy({
        shortWindow: 1,
        longWindow: 3,
        minConfidence: 0.01
      }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData,
      snapshotConfig: snapshotConfig(),
      maxHistoryCandles: 3,
      now: new Date("2026-06-19T14:31:30.000Z")
    });

    expect(marketData.historicalRequests).toEqual([
      {
        symbols: ["SPY"],
        limit: 3,
        end: "2026-06-19T14:31:30.000Z"
      }
    ]);
    expect(result.cycles[0]?.signal.reason).toBe("Short MA 110.0000 above long MA 105.0000.");
    expect(result.executions).toHaveLength(1);
  });

  it("rejects non-paper broker or snapshot modes", async () => {
    await expect(
      runPaperTradingCoordinator({
        symbols: ["SPY"],
        iterations: 1,
        intervalMs: 0,
        strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
        intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
        riskEngineFactory: () => riskEngine(),
        broker: new InMemoryPaperBroker("live"),
        marketData: new StaticMarketData({ SPY: 500 }),
        snapshotConfig: snapshotConfig(),
        now: new Date("2026-06-19T14:31:00.000Z")
      })
    ).rejects.toThrow("only runs when Alpaca trading mode is paper");
  });

  it("uses the broker calendar to fail closed after an authoritative early close", async () => {
    const broker = new CalendarPaperBroker();
    const marketData = new StaticMarketData({ SPY: 500 });
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData,
      snapshotConfig: snapshotConfig(),
      marketSession: regularUsEquitiesMarketSession(),
      now: new Date("2026-11-27T18:30:00.000Z")
    });

    expect(result.executions).toEqual([]);
    expect(result.cycles[0]?.skippedReason).toContain("configured 13:00 close");
    expect(marketData.calls).toBe(0);
    expect(broker.calendarDates).toEqual(["2026-11-27"]);
  });

  it("skips a symbol when latest market data is stale", async () => {
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      maxCandleAgeMs: 30_000,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.executions).toEqual([]);
    expect(result.cycles[0]).toMatchObject({
      symbol: "SPY",
      skippedReason: "Latest candle for SPY is stale by 60 seconds."
    });
    expect(broker.seen).toEqual([]);
  });

  it("skips entry work while the configured market session is closed", async () => {
    const broker = new InMemoryPaperBroker();
    const marketData = new StaticMarketData({ SPY: 500, AAPL: 250 });
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY", "AAPL"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData,
      snapshotConfig: snapshotConfig(),
      marketSession: regularUsEquitiesMarketSession(),
      now: new Date("2026-06-24T13:00:00.000Z")
    });

    expect(result.executions).toEqual([]);
    expect(result.cycles.map((cycle) => cycle.skippedReason)).toEqual([
      "Market session is closed: 09:00 America/New_York is before the configured 09:30 open.",
      "Market session is closed: 09:00 America/New_York is before the configured 09:30 open."
    ]);
    expect(marketData.calls).toBe(0);
    expect(broker.openOrderLookups).toBe(0);
    expect(broker.seen).toEqual([]);
  });

  it("skips exposure-increasing work when a pending order already exists for the symbol", async () => {
    const broker = new InMemoryPaperBroker();
    broker.openOrders = [pendingOrder("SPY")];
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY", "AAPL"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500, AAPL: 250 }),
      snapshotConfig: snapshotConfig(),
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.cycles[0]?.skippedReason).toBe(
      "Open accepted order pending-spy already exists for SPY."
    );
    expect(result.executions.map((execution) => execution.order.intent.symbol)).toEqual(["AAPL"]);
    expect(broker.seen.map((intent) => intent.symbol)).toEqual(["AAPL"]);
  });

  it("flags timed-out open orders for operator reconciliation without cancelling them", async () => {
    const broker = new InMemoryPaperBroker();
    broker.openOrders = [pendingOrder("SPY")];
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      maxPendingOrderAgeMs: 30_000,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.cycles[0]?.skippedReason).toContain("exceeding the 30000ms timeout");
    expect(result.executions).toEqual([]);
  });

  it("blocks new exposure when account exposure and broker positions drift", async () => {
    const broker = new DriftedPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      maxPositionDriftNotional: 5,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.cycles[0]?.skippedReason).toContain("Broker position drift 25.00");
    expect(result.executions).toEqual([]);
  });

  it("stops submitting orders after the run-level execution cap is reached", async () => {
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY", "AAPL", "MSFT"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500, AAPL: 250, MSFT: 400 }),
      snapshotConfig: snapshotConfig(),
      maxExecutionsPerRun: 1,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.executions.map((execution) => execution.order.intent.symbol)).toEqual(["SPY"]);
    expect(result.cycles.slice(1).map((cycle) => cycle.skippedReason)).toEqual([
      "Paper execution cap reached: 1 execution(s) already submitted this run.",
      "Paper execution cap reached: 1 execution(s) already submitted this run."
    ]);
    expect(broker.seen.map((intent) => intent.symbol)).toEqual(["SPY"]);
  });

  it("evaluates strategy and risk in dry-run mode without submitting paper orders", async () => {
    const stateStore = new MemoryStateStore({
      version: 1,
      updatedAt: "2026-06-19T14:30:00.000Z",
      runCount: 1,
      lastRun: {
        startedAt: "2026-06-19T14:29:00.000Z",
        completedAt: "2026-06-19T14:30:00.000Z",
        symbols: ["SPY"],
        cycleCount: 2,
        executionCount: 0,
        skippedCount: 2
      },
      pendingOrders: [],
      candleHistory: [
        stateCandle("SPY", 100, "2026-06-19T14:29:00.000Z"),
        stateCandle("SPY", 105, "2026-06-19T14:30:00.000Z")
      ]
    });
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new MovingAverageCrossoverStrategy({
        shortWindow: 1,
        longWindow: 3,
        minConfidence: 0.01
      }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new SequencedMarketData({
        SPY: [{ close: 110, closeTime: "2026-06-19T14:31:00.000Z" }]
      }),
      snapshotConfig: snapshotConfig(),
      stateStore,
      dryRun: true,
      now: new Date("2026-06-19T14:31:30.000Z")
    });

    expect(result.cycles[0]).toMatchObject({
      symbol: "SPY",
      intent: {
        symbol: "SPY",
        side: "buy"
      },
      riskDecision: {
        approved: true
      }
    });
    expect(result.executions).toEqual([]);
    expect(broker.seen).toEqual([]);
    expect(result.runSummary).toMatchObject({
      dryRun: true,
      submittedNotional: 0,
      executionCount: 0,
      skippedCount: 0
    });
    expect(result.liveOps.paperCycles?.[0]).toMatchObject({
      symbol: "SPY",
      action: "buy",
      status: "approved",
      riskApproved: true
    });
    expect(stateStore.state?.pendingOrders).toEqual([]);
  });

  it("allows zero executions for dry coordinator validation", async () => {
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      maxExecutionsPerRun: 0,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.executions).toEqual([]);
    expect(result.cycles[0]?.skippedReason).toBe(
      "Paper execution cap reached: 0 execution(s) already submitted this run."
    );
    expect(broker.seen).toEqual([]);
  });

  it("rejects invalid run-level execution caps", async () => {
    await expect(
      runPaperTradingCoordinator({
        symbols: ["SPY"],
        iterations: 1,
        intervalMs: 0,
        strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
        intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
        riskEngineFactory: () => riskEngine(),
        broker: new InMemoryPaperBroker(),
        marketData: new StaticMarketData({ SPY: 500 }),
        snapshotConfig: snapshotConfig(),
        maxExecutionsPerRun: 1.5,
        now: new Date("2026-06-19T14:31:00.000Z")
      })
    ).rejects.toThrow("maxExecutionsPerRun must be a non-negative integer");
  });

  it("rejects orders that would exceed the run-level notional cap", async () => {
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY", "AAPL"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500, AAPL: 250 }),
      snapshotConfig: snapshotConfig(),
      maxNotionalPerRun: 30,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.executions.map((execution) => execution.order.intent.symbol)).toEqual(["SPY"]);
    expect(result.cycles[1]).toMatchObject({
      symbol: "AAPL",
      skippedReason: "Projected paper run notional 50.00 exceeds max run notional 30.00."
    });
    expect(result.cycles[1]?.riskDecision?.appliedRules).toContain("max-run-notional");
    expect(result.liveOps.paperCycles?.[1]).toMatchObject({
      symbol: "AAPL",
      status: "rejected",
      skippedReason: "Projected paper run notional 50.00 exceeds max run notional 30.00.",
      riskApproved: false
    });
    expect(broker.seen.map((intent) => intent.symbol)).toEqual(["SPY"]);
    expect(result.runSummary).toEqual({
      dryRun: false,
      submittedNotional: 25,
      maxNotionalPerRun: 30,
      executionCount: 1,
      maxExecutionsPerRun: null,
      skippedCount: 1
    });
  });

  it("blocks repeat paper executions from the same latest candle", async () => {
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 2,
      intervalMs: 0,
      strategy: new MovingAverageCrossoverStrategy({
        shortWindow: 1,
        longWindow: 3,
        minConfidence: 0.01
      }),
      intentMapper: new AllocationIntentMapper({
        accountEquity: 100_000,
        targetAllocationPct: 0.001,
        maxNotionalPerTrade: 50
      }),
      riskEngineFactory: () =>
        new BasicRiskEngine({
          maxOrderNotional: 100,
          maxPositionNotional: 250,
          maxDailyLossPct: 0.01,
          blockHighImpactEventsAtOrAbove: 1,
          maxGrossLeverage: 0.25
        }),
      broker,
      marketData: new SequencedMarketData({
        SPY: [
          { close: 110, closeTime: "2026-06-19T14:31:00.000Z" },
          { close: 110, closeTime: "2026-06-19T14:31:00.000Z" }
        ]
      }),
      snapshotConfig: snapshotConfig(),
      stateStore: new MemoryStateStore({
        version: 1,
        updatedAt: "2026-06-19T14:30:00.000Z",
        runCount: 1,
        lastRun: {
          startedAt: "2026-06-19T14:29:00.000Z",
          completedAt: "2026-06-19T14:30:00.000Z",
          symbols: ["SPY"],
          cycleCount: 2,
          executionCount: 0,
          skippedCount: 2
        },
        pendingOrders: [],
        candleHistory: [
          stateCandle("SPY", 100, "2026-06-19T14:29:00.000Z"),
          stateCandle("SPY", 105, "2026-06-19T14:30:00.000Z")
        ]
      }),
      now: new Date("2026-06-19T14:31:30.000Z")
    });

    expect(result.executions.map((execution) => execution.order.intent.side)).toEqual(["buy"]);
    expect(broker.seen).toHaveLength(1);
    expect(result.cycles[1]).toMatchObject({
      symbol: "SPY",
      skippedReason:
        "Last paper execution for SPY already used latest candle 2026-06-19T14:31:00.000Z; waiting for a fresh candle."
    });
    expect(result.cycles[1]?.riskDecision?.appliedRules).toContain("fresh-candle-execution");
    expect(result.liveOps.paperCycles?.map((cycle) => cycle.status)).toEqual([
      "submitted",
      "rejected"
    ]);
  });

  it("allows zero run notional for risk-layer dry validation", async () => {
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      maxNotionalPerRun: 0,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.executions).toEqual([]);
    expect(result.cycles[0]).toMatchObject({
      symbol: "SPY",
      skippedReason: "Projected paper run notional 25.00 exceeds max run notional 0.00."
    });
    expect(result.cycles[0]?.riskDecision?.appliedRules).toContain("max-run-notional");
    expect(broker.seen).toEqual([]);
  });

  it("rejects invalid run-level notional caps", async () => {
    await expect(
      runPaperTradingCoordinator({
        symbols: ["SPY"],
        iterations: 1,
        intervalMs: 0,
        strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
        intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
        riskEngineFactory: () => riskEngine(),
        broker: new InMemoryPaperBroker(),
        marketData: new StaticMarketData({ SPY: 500 }),
        snapshotConfig: snapshotConfig(),
        maxNotionalPerRun: -1,
        now: new Date("2026-06-19T14:31:00.000Z")
      })
    ).rejects.toThrow("maxNotionalPerRun must be non-negative");
  });

  it("writes restart state with pending orders after a coordinator run", async () => {
    const stateStore = new MemoryStateStore();
    await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker: new InMemoryPaperBroker(),
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      stateStore,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(stateStore.state).toMatchObject({
      version: 1,
      runCount: 1,
      lastRun: {
        symbols: ["SPY"],
        cycleCount: 1,
        executionCount: 1,
        skippedCount: 0
      },
      pendingOrders: [
        {
          id: "paper-1",
          symbol: "SPY",
          side: "buy",
          quantity: 0.05,
          status: "accepted",
          strategyId: "buy-and-hold"
        }
      ]
    });
  });

  it("uses persisted pending orders to block restart exposure until reconciliation", async () => {
    const stateStore = new MemoryStateStore({
      version: 1,
      updatedAt: "2026-06-19T14:30:00.000Z",
      runCount: 1,
      lastRun: {
        startedAt: "2026-06-19T14:29:00.000Z",
        completedAt: "2026-06-19T14:30:00.000Z",
        symbols: ["SPY"],
        cycleCount: 1,
        executionCount: 1,
        skippedCount: 0
      },
      pendingOrders: [
        {
          id: "paper-previous",
          symbol: "SPY",
          side: "buy",
          quantity: 0.05,
          status: "accepted",
          strategyId: "buy-and-hold",
          updatedAt: "2026-06-19T14:30:00.000Z"
        }
      ]
    });
    const broker = new InMemoryPaperBroker();
    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      stateStore,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.executions).toEqual([]);
    expect(result.cycles[0]?.skippedReason).toBe(
      "Persisted order paper-previous was not found at the broker; exposure remains blocked for SPY."
    );
    expect(broker.seen).toEqual([]);
    expect(stateStore.state?.runCount).toBe(2);
    expect(stateStore.state?.lastRun.skippedCount).toBe(1);
    expect(stateStore.state?.pendingOrders).toEqual([
      expect.objectContaining({
        id: "paper-previous",
        reconciliationStatus: "not-found",
        reconciliationDetail: "Broker order was not found; exposure remains blocked."
      })
    ]);
  });

  it("reconciles a crash-window submission by client id and quarantines its symbol", async () => {
    const broker = new JournalLookupBroker();
    broker.clientOrders.set("bot-crash-window", pendingOrder("SPY"));
    const journal = new MemorySubmissionJournal([
      {
        idempotencyKey: "bot-crash-window",
        intent: pendingOrder("SPY").intent,
        status: "prepared",
        preparedAt: "2026-06-19T14:30:00.000Z",
        updatedAt: "2026-06-19T14:30:00.000Z"
      }
    ]);

    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      submissionJournal: journal,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.executions).toEqual([]);
    expect(result.cycles[0]?.skippedReason).toContain("reconciled to broker order");
    expect(await journal.unresolved()).toEqual([]);
  });

  it("clears terminal orders but quarantines the symbol until the next run", async () => {
    const stateStore = new MemoryStateStore({
      version: 1,
      updatedAt: "2026-06-19T14:30:00.000Z",
      runCount: 1,
      lastRun: {
        startedAt: "2026-06-19T14:29:00.000Z",
        completedAt: "2026-06-19T14:30:00.000Z",
        symbols: ["SPY"],
        cycleCount: 1,
        executionCount: 1,
        skippedCount: 0
      },
      pendingOrders: [
        {
          id: "paper-previous",
          symbol: "SPY",
          side: "buy",
          quantity: 0.05,
          status: "accepted",
          strategyId: "buy-and-hold",
          updatedAt: "2026-06-19T14:30:00.000Z"
        }
      ]
    });
    const broker = new InMemoryPaperBroker();
    broker.orderLookups.set("paper-previous", {
      ...pendingOrder("SPY"),
      id: "paper-previous",
      status: "filled"
    });

    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      stateStore,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.executions).toEqual([]);
    expect(result.cycles[0]?.skippedReason).toBe(
      "Persisted order paper-previous is filled; waiting until the next run for broker positions to converge for SPY."
    );
    expect(broker.seen).toEqual([]);
    expect(stateStore.state?.pendingOrders).toEqual([]);

    const nextRun = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      stateStore,
      now: new Date("2026-06-19T14:32:00.000Z")
    });

    expect(nextRun.executions).toHaveLength(1);
    expect(broker.seen.map((intent) => intent.symbol)).toEqual(["SPY"]);
  });

  it("keeps broker partial fills pending and records fill progress in restart state", async () => {
    const stateStore = new MemoryStateStore({
      version: 1,
      updatedAt: "2026-06-19T14:30:00.000Z",
      runCount: 1,
      lastRun: {
        startedAt: "2026-06-19T14:29:00.000Z",
        completedAt: "2026-06-19T14:30:00.000Z",
        symbols: ["SPY"],
        cycleCount: 1,
        executionCount: 1,
        skippedCount: 0
      },
      pendingOrders: [
        {
          id: "paper-previous",
          symbol: "SPY",
          side: "buy",
          quantity: 0.05,
          status: "accepted",
          strategyId: "buy-and-hold",
          updatedAt: "2026-06-19T14:30:00.000Z"
        }
      ]
    });
    const broker = new InMemoryPaperBroker();
    broker.orderLookups.set("paper-previous", {
      ...pendingOrder("SPY"),
      id: "paper-previous",
      status: "partially-filled",
      filledQuantity: 0.02,
      averageFillPrice: 500.25
    });

    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      stateStore,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.executions).toEqual([]);
    expect(result.cycles[0]?.skippedReason).toBe(
      "Persisted partially-filled order paper-previous requires reconciliation for SPY."
    );
    expect(stateStore.state?.pendingOrders).toEqual([
      expect.objectContaining({
        id: "paper-previous",
        symbol: "SPY",
        status: "partially-filled",
        filledQuantity: 0.02,
        averageFillPrice: 500.25,
        reconciliationStatus: "confirmed-pending"
      })
    ]);
  });

  it("keeps exposure blocked and records broker lookup failures", async () => {
    const stateStore = new MemoryStateStore({
      version: 1,
      updatedAt: "2026-06-19T14:30:00.000Z",
      runCount: 1,
      lastRun: {
        startedAt: "2026-06-19T14:29:00.000Z",
        completedAt: "2026-06-19T14:30:00.000Z",
        symbols: ["SPY"],
        cycleCount: 1,
        executionCount: 1,
        skippedCount: 0
      },
      pendingOrders: [
        {
          id: "paper-previous",
          symbol: "SPY",
          side: "buy",
          quantity: 0.05,
          status: "accepted",
          strategyId: "buy-and-hold",
          updatedAt: "2026-06-19T14:30:00.000Z"
        }
      ]
    });
    const broker = new InMemoryPaperBroker();
    broker.failedOrderLookups.add("paper-previous");

    const result = await runPaperTradingCoordinator({
      symbols: ["SPY"],
      iterations: 1,
      intervalMs: 0,
      strategy: new BuyAndHoldStrategy({ targetAllocationPct: 1 }),
      intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: 25 }),
      riskEngineFactory: () => riskEngine(),
      broker,
      marketData: new StaticMarketData({ SPY: 500 }),
      snapshotConfig: snapshotConfig(),
      stateStore,
      now: new Date("2026-06-19T14:31:00.000Z")
    });

    expect(result.executions).toEqual([]);
    expect(result.cycles[0]?.skippedReason).toBe(
      "Broker lookup failed for persisted order paper-previous; exposure remains blocked for SPY."
    );
    expect(stateStore.state?.pendingOrders).toEqual([
      expect.objectContaining({
        id: "paper-previous",
        reconciliationStatus: "lookup-failed",
        reconciliationDetail: "Broker order lookup failed; exposure remains blocked."
      })
    ]);
  });
});

class StaticMarketData implements PaperTradingMarketData {
  calls = 0;

  constructor(private readonly prices: Record<string, number>) {}

  async getLatestBars(symbols: string[]): Promise<Candle[]> {
    this.calls += 1;

    return symbols.map((symbol) => {
      const close = this.prices[symbol] ?? 100;

      return {
        symbol,
        timeframe: "1m",
        openTime: new Date("2026-06-19T14:29:00.000Z"),
        closeTime: new Date("2026-06-19T14:30:00.000Z"),
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1000
      };
    });
  }
}

class SequencedMarketData implements PaperTradingMarketData {
  private iteration = 0;

  constructor(private readonly bars: Record<string, Array<{ close: number; closeTime: string }>>) {}

  async getLatestBars(symbols: string[]): Promise<Candle[]> {
    const currentIteration = this.iteration;
    this.iteration += 1;

    return symbols.map((symbol) => {
      const sequence = this.bars[symbol] ?? [{ close: 100, closeTime: "2026-06-19T14:30:00.000Z" }];
      const bar = sequence[Math.min(currentIteration, sequence.length - 1)]!;

      return {
        symbol,
        timeframe: "1m",
        openTime: new Date(new Date(bar.closeTime).getTime() - 60_000),
        closeTime: new Date(bar.closeTime),
        open: bar.close,
        high: bar.close + 1,
        low: bar.close - 1,
        close: bar.close,
        volume: 1000
      };
    });
  }
}

class BootstrapMarketData implements PaperTradingMarketData {
  readonly historicalRequests: Array<{ symbols: string[]; limit: number; end?: string }> = [];

  async getHistoricalBars(
    symbols: string[],
    request: { limit: number; end?: Date }
  ): Promise<Candle[]> {
    this.historicalRequests.push({
      symbols,
      limit: request.limit,
      ...(request.end ? { end: request.end.toISOString() } : {})
    });
    return [
      candle("SPY", 100, "2026-06-19T14:29:00.000Z"),
      candle("SPY", 105, "2026-06-19T14:30:00.000Z")
    ];
  }

  async getLatestBars(): Promise<Candle[]> {
    return [candle("SPY", 110, "2026-06-19T14:31:00.000Z")];
  }
}

class InMemoryPaperBroker implements PaperTradingBroker {
  readonly seen: OrderIntent[] = [];
  openOrders: Order[] = [];
  openOrderLookups = 0;
  readonly orderLookups = new Map<string, Order>();
  readonly failedOrderLookups = new Set<string>();
  private readonly positions = new Map<string, Position>();

  constructor(readonly mode: "paper" | "live" = "paper") {}

  seedPosition(position: Position): void {
    this.positions.set(position.symbol, position);
  }

  async placeOrder(intent: OrderIntent): Promise<ExecutionResult> {
    this.seen.push(intent);
    this.applyIntent(intent);
    const now = new Date("2026-06-19T14:30:00.000Z");

    return {
      order: {
        id: `paper-${this.seen.length}`,
        intent,
        status: "accepted",
        createdAt: now,
        updatedAt: now
      },
      fills: []
    };
  }

  async cancelOrder(orderId: string): Promise<Order> {
    const now = new Date("2026-06-19T14:30:00.000Z");

    return {
      id: orderId,
      intent: this.seen[0]!,
      status: "cancelled",
      createdAt: now,
      updatedAt: now
    };
  }

  async getOrder(orderId: string): Promise<Order | undefined> {
    if (this.failedOrderLookups.has(orderId)) {
      throw new Error("Simulated broker lookup failure.");
    }

    return this.orderLookups.get(orderId);
  }

  async getAccountSnapshot(): Promise<AccountSnapshot> {
    const grossExposure = [...this.positions.values()].reduce(
      (sum, position) => sum + Math.abs(position.quantity * position.markPrice),
      0
    );

    return {
      equity: 100_000,
      cash: 100_000 - grossExposure,
      buyingPower: 400_000 - grossExposure,
      realizedPnl: 0,
      unrealizedPnl: 0,
      positionValue: grossExposure,
      grossExposure,
      currency: "USD",
      timestamp: new Date("2026-06-19T14:30:00.000Z")
    };
  }

  async getOpenPositions(): Promise<Position[]> {
    return [...this.positions.values()];
  }

  async getOpenOrders(): Promise<Order[]> {
    this.openOrderLookups += 1;
    return this.openOrders;
  }

  private applyIntent(intent: OrderIntent): void {
    const markPrice = intent.limitPrice ?? 1;
    const existing = this.positions.get(intent.symbol);
    const signedQuantity = intent.side === "buy" ? intent.quantity : -intent.quantity;
    const quantity = (existing?.quantity ?? 0) + signedQuantity;

    if (Math.abs(quantity) <= 1e-10) {
      this.positions.delete(intent.symbol);
      return;
    }

    this.positions.set(intent.symbol, {
      symbol: intent.symbol,
      quantity,
      averageEntryPrice: existing?.averageEntryPrice ?? markPrice,
      markPrice,
      unrealizedPnl: 0,
      updatedAt: new Date("2026-06-19T14:30:00.000Z")
    });
  }
}

class CalendarPaperBroker extends InMemoryPaperBroker {
  readonly calendarDates: string[] = [];

  async getMarketCalendar(startDate: string) {
    this.calendarDates.push(startDate);
    return [{ date: startDate, openTime: "09:30", closeTime: "13:00" }];
  }
}

class DriftedPaperBroker extends InMemoryPaperBroker {
  async getAccountSnapshot(): Promise<AccountSnapshot> {
    return { ...(await super.getAccountSnapshot()), grossExposure: 25, positionValue: 25 };
  }
}

class JournalLookupBroker extends InMemoryPaperBroker {
  readonly clientOrders = new Map<string, Order>();
  async getOrderByClientOrderId(clientOrderId: string) {
    return this.clientOrders.get(clientOrderId);
  }
}

class MemorySubmissionJournal implements SubmissionJournal {
  constructor(private entries: SubmissionJournalEntry[]) {}
  async prepare() {}
  async confirm(idempotencyKey: string) {
    this.entries = this.entries.filter((entry) => entry.idempotencyKey !== idempotencyKey);
  }
  async markNotFound(idempotencyKey: string) {
    this.entries = this.entries.filter((entry) => entry.idempotencyKey !== idempotencyKey);
  }
  async unresolved() {
    return [...this.entries];
  }
}

class MemoryStateStore implements PaperTradingStateStore {
  constructor(public state?: PaperTradingCoordinatorState) {}

  async load(): Promise<PaperTradingCoordinatorState | undefined> {
    return this.state;
  }

  async save(state: PaperTradingCoordinatorState): Promise<void> {
    this.state = state;
  }
}

function pendingOrder(symbol: string): Order {
  const now = new Date("2026-06-19T14:30:00.000Z");

  return {
    id: `pending-${symbol.toLowerCase()}`,
    intent: {
      symbol,
      side: "buy",
      type: "market",
      quantity: 0.05,
      limitPrice: 500,
      reason: "existing paper order",
      strategyId: "buy-and-hold"
    },
    status: "accepted",
    createdAt: now,
    updatedAt: now
  };
}

function stateCandle(symbol: string, close: number, closeTime: string) {
  return {
    symbol,
    timeframe: "1m" as const,
    openTime: new Date(new Date(closeTime).getTime() - 60_000).toISOString(),
    closeTime,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000
  };
}

function candle(symbol: string, close: number, closeTime: string): Candle {
  return {
    ...stateCandle(symbol, close, closeTime),
    openTime: new Date(new Date(closeTime).getTime() - 60_000),
    closeTime: new Date(closeTime)
  };
}

function riskEngine(): BasicRiskEngine {
  return new BasicRiskEngine({
    maxOrderNotional: 50,
    maxPositionNotional: 250,
    maxDailyLossPct: 0.01,
    blockHighImpactEventsAtOrAbove: 1,
    maxGrossLeverage: 0.25
  });
}

function snapshotConfig(): LiveOpsSnapshotConfig {
  return {
    mode: "paper",
    dayStartingEquity: 100_000,
    dayFeesPaid: 0,
    maxDailyLoss: 100,
    maxGrossExposurePct: 25,
    liveTradingEnabled: false,
    operatorConfirmedLive: false,
    killSwitchArmed: true,
    stopAfterBreakEven: false,
    brokerCredentialsConfigured: true,
    requirePriorBreakEvenAudit: false
  };
}
