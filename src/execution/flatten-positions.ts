import type { OrderIntent, Position } from "../core/types.js";
import type { ExecutionResult, OrderExecutor } from "./interfaces.js";

export interface FlattenPositionsResult {
  intents: OrderIntent[];
  executions: ExecutionResult[];
}

export async function flattenOpenPositions(
  positions: Position[],
  executor: OrderExecutor,
  strategyId = "position-flattener"
): Promise<FlattenPositionsResult> {
  const intents = buildFlattenPositionIntents(positions, strategyId);
  const executions: ExecutionResult[] = [];

  for (const intent of intents) {
    executions.push(await executor.placeOrder(intent));
  }

  return { intents, executions };
}

export function buildFlattenPositionIntents(
  positions: Position[],
  strategyId = "position-flattener"
): OrderIntent[] {
  return positions
    .filter((position) => Math.abs(position.quantity) > 1e-10)
    .map((position) => ({
      symbol: position.symbol,
      side: position.quantity > 0 ? "sell" : "buy",
      type: "market",
      quantity: Math.abs(position.quantity),
      limitPrice: position.markPrice,
      reason: "Reduce open exposure to preserve break-even controls.",
      strategyId
    }));
}
