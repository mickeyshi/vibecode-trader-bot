import { randomUUID } from "node:crypto";
import type { Order, OrderIntent } from "../core/types.js";
import type { SubmissionJournal } from "./paper-trading-state.js";
import type { ExecutionResult, OrderExecutor } from "./interfaces.js";

export class JournaledOrderExecutor implements OrderExecutor {
  readonly mode;

  constructor(
    private readonly inner: OrderExecutor,
    private readonly journal: SubmissionJournal,
    private readonly now: () => Date = () => new Date()
  ) {
    this.mode = inner.mode;
  }

  async placeOrder(intent: OrderIntent): Promise<ExecutionResult> {
    const idempotencyKey = intent.idempotencyKey ?? `bot-${randomUUID()}`;
    const journaledIntent = { ...intent, idempotencyKey };
    await this.journal.prepare(idempotencyKey, journaledIntent, this.now());
    const result = await this.inner.placeOrder(journaledIntent);
    await this.journal.confirm(idempotencyKey, result.order, this.now());
    return result;
  }

  cancelOrder(orderId: string): Promise<Order> {
    return this.inner.cancelOrder(orderId);
  }

  getOrder(orderId: string): Promise<Order | undefined> {
    return this.inner.getOrder(orderId);
  }
}
