import { describe, expect, it } from "vitest";
import type { Order, OrderIntent, Position } from "../src/core/types.js";
import {
  buildFlattenPositionIntents,
  flattenOpenPositions
} from "../src/execution/flatten-positions.js";
import type { ExecutionResult, OrderExecutor } from "../src/execution/interfaces.js";

describe("flatten positions", () => {
  it("builds reduce-only market intents for long and short positions", () => {
    expect(buildFlattenPositionIntents([longPosition(), shortPosition()], "flattener")).toEqual([
      {
        symbol: "SPY",
        side: "sell",
        type: "market",
        quantity: 2,
        limitPrice: 420,
        reason: "Reduce open exposure to preserve break-even controls.",
        strategyId: "flattener"
      },
      {
        symbol: "MSFT",
        side: "buy",
        type: "market",
        quantity: 3,
        limitPrice: 300,
        reason: "Reduce open exposure to preserve break-even controls.",
        strategyId: "flattener"
      }
    ]);
  });

  it("ignores flat positions", () => {
    expect(
      buildFlattenPositionIntents([
        {
          ...longPosition(),
          quantity: 0
        }
      ])
    ).toEqual([]);
  });

  it("submits each flatten intent through the provided executor", async () => {
    const executor = new StubExecutor();

    const result = await flattenOpenPositions([longPosition(), shortPosition()], executor);

    expect(executor.seen.map((intent) => [intent.symbol, intent.side, intent.quantity])).toEqual([
      ["SPY", "sell", 2],
      ["MSFT", "buy", 3]
    ]);
    expect(result.executions).toHaveLength(2);
  });
});

class StubExecutor implements OrderExecutor {
  readonly mode = "paper";
  readonly seen: OrderIntent[] = [];

  async placeOrder(intent: OrderIntent): Promise<ExecutionResult> {
    this.seen.push(intent);
    const now = new Date("2026-06-19T14:30:00.000Z");
    return {
      order: {
        id: `flatten-${this.seen.length}`,
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

  async getOrder(): Promise<Order | undefined> {
    return undefined;
  }
}

function longPosition(): Position {
  return {
    symbol: "SPY",
    quantity: 2,
    averageEntryPrice: 400,
    markPrice: 420,
    unrealizedPnl: 40,
    updatedAt: new Date("2026-06-19T14:30:00.000Z")
  };
}

function shortPosition(): Position {
  return {
    symbol: "MSFT",
    quantity: -3,
    averageEntryPrice: 310,
    markPrice: 300,
    unrealizedPnl: 30,
    updatedAt: new Date("2026-06-19T14:30:00.000Z")
  };
}
