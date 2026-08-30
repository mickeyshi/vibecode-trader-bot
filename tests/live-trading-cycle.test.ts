import { describe, expect, it } from "vitest";
import type { Candle, Order, OrderIntent } from "../src/core/types.js";
import {
  liveTradingCycleOrderRows,
  runLiveTradingCycle
} from "../src/execution/live-trading-cycle.js";
import type { ExecutionResult, OrderExecutor } from "../src/execution/interfaces.js";
import type { RiskDecision, RiskEngine } from "../src/risk/interfaces.js";
import type { StrategyContext } from "../src/data/interfaces.js";
import { BuyAndHoldStrategy } from "../src/strategies/buy-and-hold-strategy.js";
import { FixedNotionalIntentMapper } from "../src/strategies/fixed-notional-intent-mapper.js";
import type {
  SignalToIntentMapper,
  Strategy,
  StrategySignal
} from "../src/strategies/interfaces.js";

describe("live trading cycle", () => {
  it("skips execution when the strategy holds", async () => {
    const executor = new StubExecutor();
    const result = await runLiveTradingCycle({
      symbol: "SPY",
      mode: "paper",
      strategy: new StaticStrategy("hold"),
      intentMapper: new TestIntentMapper(),
      riskEngine: new ApprovingRiskEngine(),
      executor,
      accountSnapshot: accountSnapshot(),
      candles: candles(),
      positions: []
    });

    expect(result.skippedReason).toBe("Strategy did not produce an order intent.");
    expect(executor.orderCount).toBe(0);
  });

  it("skips execution when risk rejects the intent", async () => {
    const executor = new StubExecutor();
    const result = await runLiveTradingCycle({
      symbol: "SPY",
      mode: "paper",
      strategy: new StaticStrategy("buy"),
      intentMapper: new TestIntentMapper(),
      riskEngine: new RejectingRiskEngine(),
      executor,
      accountSnapshot: accountSnapshot(),
      candles: candles(),
      positions: []
    });

    expect(result.riskDecision).toMatchObject({
      approved: false,
      reason: "blocked by test"
    });
    expect(result.skippedReason).toBe("blocked by test");
    expect(executor.orderCount).toBe(0);
  });

  it("places an order through the provided executor after signal and risk approval", async () => {
    const executor = new StubExecutor();
    const result = await runLiveTradingCycle({
      symbol: "SPY",
      mode: "paper",
      strategy: new StaticStrategy("buy"),
      intentMapper: new TestIntentMapper(),
      riskEngine: new ApprovingRiskEngine(),
      executor,
      accountSnapshot: accountSnapshot(),
      candles: candles(),
      positions: []
    });

    expect(executor.orderCount).toBe(1);
    expect(result.executionResult?.order).toMatchObject({
      status: "accepted"
    });
    expect(liveTradingCycleOrderRows(result)[0]).toMatchObject({
      id: "test-1",
      strategyId: "test-strategy",
      symbol: "SPY",
      side: "buy",
      status: "accepted"
    });
  });

  it("can evaluate an approved order intent without submitting it", async () => {
    const executor = new StubExecutor();
    const result = await runLiveTradingCycle({
      symbol: "SPY",
      mode: "paper",
      strategy: new StaticStrategy("buy"),
      intentMapper: new TestIntentMapper(),
      riskEngine: new ApprovingRiskEngine(),
      executor,
      accountSnapshot: accountSnapshot(),
      candles: candles(),
      positions: [],
      submitOrders: false
    });

    expect(executor.orderCount).toBe(0);
    expect(result.executionResult).toBeUndefined();
    expect(result.intent).toMatchObject({
      symbol: "SPY",
      side: "buy"
    });
    expect(result.riskDecision).toMatchObject({
      approved: true
    });
  });

  it("turns risk rejections into order blotter rows", async () => {
    const result = await runLiveTradingCycle({
      symbol: "SPY",
      mode: "paper",
      strategy: new StaticStrategy("buy"),
      intentMapper: new TestIntentMapper(),
      riskEngine: new RejectingRiskEngine(),
      executor: new StubExecutor(),
      accountSnapshot: accountSnapshot(),
      candles: candles(),
      positions: []
    });

    expect(liveTradingCycleOrderRows(result)[0]).toMatchObject({
      strategyId: "test-strategy",
      symbol: "SPY",
      status: "rejected",
      reason: "blocked by test"
    });
  });

  it("buys once per symbol in paper mode and avoids duplicate buy-and-hold entries", async () => {
    const executor = new StubExecutor();
    const strategy = new BuyAndHoldStrategy({ targetAllocationPct: 1 });
    const intentMapper = new FixedNotionalIntentMapper({ notionalPerTrade: 25 });
    const riskEngine = new ApprovingRiskEngine();
    const firstSpyCycle = await runLiveTradingCycle({
      symbol: "SPY",
      mode: "paper",
      strategy,
      intentMapper,
      riskEngine,
      executor,
      accountSnapshot: accountSnapshot(),
      candles: candles("SPY", 500),
      positions: []
    });
    const secondSpyCycle = await runLiveTradingCycle({
      symbol: "SPY",
      mode: "paper",
      strategy,
      intentMapper,
      riskEngine,
      executor,
      accountSnapshot: accountSnapshot(),
      candles: candles("SPY", 501),
      positions: [position("SPY", 0.05, 500)]
    });
    const firstAaplCycle = await runLiveTradingCycle({
      symbol: "AAPL",
      mode: "paper",
      strategy,
      intentMapper,
      riskEngine,
      executor,
      accountSnapshot: accountSnapshot(),
      candles: candles("AAPL", 250),
      positions: [position("SPY", 0.05, 501)]
    });

    expect(firstSpyCycle.executionResult?.order.intent).toMatchObject({
      symbol: "SPY",
      side: "buy",
      quantity: 0.05,
      limitPrice: 500
    });
    expect(secondSpyCycle.skippedReason).toBe("Strategy did not produce an order intent.");
    expect(firstAaplCycle.executionResult?.order.intent).toMatchObject({
      symbol: "AAPL",
      side: "buy",
      quantity: 0.1,
      limitPrice: 250
    });
    expect(executor.seen.map((intent) => [intent.symbol, intent.side])).toEqual([
      ["SPY", "buy"],
      ["AAPL", "buy"]
    ]);
  });
});

class StaticStrategy implements Strategy {
  readonly id = "test-strategy";

  constructor(private readonly action: StrategySignal["action"]) {}

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    return {
      strategyId: this.id,
      symbol: context.symbol,
      action: this.action,
      confidence: this.action === "hold" ? 0 : 1,
      reason: "test signal",
      createdAt: context.now
    };
  }
}

class TestIntentMapper implements SignalToIntentMapper {
  map(signal: StrategySignal): OrderIntent | undefined {
    if (signal.action === "hold") return undefined;

    return {
      symbol: signal.symbol,
      side: signal.action,
      type: "limit",
      quantity: 1,
      limitPrice: 100,
      reason: signal.reason,
      strategyId: signal.strategyId
    };
  }
}

class ApprovingRiskEngine implements RiskEngine {
  async evaluate(intent: OrderIntent): Promise<RiskDecision> {
    return {
      approved: true,
      intent,
      reason: "approved",
      appliedRules: ["test"]
    };
  }
}

class RejectingRiskEngine implements RiskEngine {
  async evaluate(): Promise<RiskDecision> {
    return {
      approved: false,
      reason: "blocked by test",
      appliedRules: ["test"]
    };
  }
}

class StubExecutor implements OrderExecutor {
  readonly mode = "paper";
  readonly seen: OrderIntent[] = [];
  orderCount = 0;

  async placeOrder(intent: OrderIntent): Promise<ExecutionResult> {
    this.orderCount += 1;
    this.seen.push(intent);
    const now = new Date("2026-06-19T14:30:00.000Z");
    return {
      order: {
        id: `test-${this.orderCount}`,
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
      intent: {
        symbol: "SPY",
        side: "sell",
        type: "market",
        quantity: 1,
        reason: "test cancel",
        strategyId: "test-strategy"
      },
      status: "cancelled",
      createdAt: now,
      updatedAt: now
    };
  }

  async getOrder(): Promise<Order | undefined> {
    return undefined;
  }
}

function accountSnapshot(): Parameters<typeof runLiveTradingCycle>[0]["accountSnapshot"] {
  return {
    equity: 10_000,
    cash: 10_000,
    buyingPower: 10_000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    positionValue: 0,
    grossExposure: 0,
    currency: "USD",
    timestamp: new Date("2026-06-19T14:30:00.000Z")
  };
}

function candles(symbol = "SPY", close = 100): Candle[] {
  return [
    {
      symbol,
      timeframe: "1m",
      openTime: new Date("2026-06-19T14:29:00.000Z"),
      closeTime: new Date("2026-06-19T14:30:00.000Z"),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000
    }
  ];
}

function position(
  symbol: string,
  quantity: number,
  markPrice: number
): NonNullable<Parameters<typeof runLiveTradingCycle>[0]["positions"]>[number] {
  return {
    symbol,
    quantity,
    averageEntryPrice: markPrice,
    markPrice,
    unrealizedPnl: 0,
    updatedAt: new Date("2026-06-19T14:30:00.000Z")
  };
}
