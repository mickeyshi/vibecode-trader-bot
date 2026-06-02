import type { Fill, Order, OrderIntent, TradingMode } from "../core/types.js";

export interface ExecutionResult {
  order: Order;
  fills: Fill[];
  rawResponse?: unknown;
}

export interface OrderExecutor {
  readonly mode: TradingMode;
  placeOrder(intent: OrderIntent): Promise<ExecutionResult>;
  cancelOrder(orderId: string): Promise<Order>;
  getOrder(orderId: string): Promise<Order | undefined>;
}
