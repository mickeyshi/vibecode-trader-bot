import { describe, expect, it } from "vitest";
import type { Order, OrderIntent } from "../src/core/types.js";
import type { ExecutionResult, OrderExecutor } from "../src/execution/interfaces.js";
import { JournaledOrderExecutor } from "../src/execution/journaled-order-executor.js";
import type {
  SubmissionJournal,
  SubmissionJournalEntry
} from "../src/execution/paper-trading-state.js";

describe("JournaledOrderExecutor", () => {
  it("writes the durable preparation before invoking the broker", async () => {
    const events: string[] = [];
    const journal = new MemoryJournal(events);
    const broker = new Broker(events);
    const executor = new JournaledOrderExecutor(
      broker,
      journal,
      () => new Date("2026-06-19T14:30:00.000Z")
    );

    const result = await executor.placeOrder(intent());

    expect(events).toEqual(["prepare", "broker", "confirm"]);
    expect(result.order.intent.idempotencyKey).toMatch(/^bot-/);
  });

  it("leaves a prepared entry unresolved when the broker outcome is unknown", async () => {
    const events: string[] = [];
    const journal = new MemoryJournal(events);
    const broker = new Broker(events, true);
    const executor = new JournaledOrderExecutor(broker, journal);

    await expect(executor.placeOrder(intent())).rejects.toThrow("connection lost");
    await expect(journal.unresolved()).resolves.toHaveLength(1);
  });
});

class MemoryJournal implements SubmissionJournal {
  private entries: SubmissionJournalEntry[] = [];
  constructor(private readonly events: string[]) {}
  async prepare(idempotencyKey: string, orderIntent: OrderIntent, now: Date) {
    this.events.push("prepare");
    this.entries.push({
      idempotencyKey,
      intent: orderIntent,
      status: "prepared",
      preparedAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
  }
  async confirm(idempotencyKey: string) {
    this.events.push("confirm");
    this.entries = this.entries.filter((entry) => entry.idempotencyKey !== idempotencyKey);
  }
  async markNotFound() {}
  async unresolved() {
    return [...this.entries];
  }
}

class Broker implements OrderExecutor {
  readonly mode = "paper" as const;
  constructor(
    private readonly events: string[],
    private readonly fail = false
  ) {}
  async placeOrder(orderIntent: OrderIntent): Promise<ExecutionResult> {
    this.events.push("broker");
    if (this.fail) throw new Error("connection lost");
    const now = new Date("2026-06-19T14:30:00.000Z");
    return {
      order: {
        id: "broker-1",
        intent: orderIntent,
        status: "accepted",
        createdAt: now,
        updatedAt: now
      },
      fills: []
    };
  }
  async cancelOrder(): Promise<Order> {
    throw new Error("unused");
  }
  async getOrder(): Promise<Order | undefined> {
    return undefined;
  }
}

function intent(): OrderIntent {
  return {
    symbol: "SPY",
    side: "buy",
    type: "market",
    quantity: 0.05,
    reason: "test",
    strategyId: "buy-and-hold"
  };
}
