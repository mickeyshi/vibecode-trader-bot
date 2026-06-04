import type { StrategyContext } from "../data/interfaces.js";
import type { Strategy, StrategySignal } from "./interfaces.js";

export interface BuyAndHoldStrategyConfig {
  targetAllocationPct: number;
}

export class BuyAndHoldStrategy implements Strategy {
  readonly id = "buy-and-hold";

  constructor(private readonly config: BuyAndHoldStrategyConfig = { targetAllocationPct: 1 }) {}

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const hasPosition = context.positions.some(
      (position) => position.symbol === context.symbol && position.quantity > 0
    );

    return {
      strategyId: this.id,
      symbol: context.symbol,
      action: hasPosition ? "hold" : "buy",
      confidence: hasPosition ? 0 : this.config.targetAllocationPct,
      reason: hasPosition
        ? "Long position already open."
        : `Open long position targeting ${(this.config.targetAllocationPct * 100).toFixed(0)}% allocation.`,
      createdAt: context.now
    };
  }
}
