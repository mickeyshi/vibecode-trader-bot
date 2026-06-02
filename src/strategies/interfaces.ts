import type { OrderIntent } from "../core/types.js";
import type { StrategyContext } from "../data/interfaces.js";

export interface StrategySignal {
  strategyId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  confidence: number;
  reason: string;
  createdAt: Date;
}

export interface Strategy {
  readonly id: string;
  evaluate(context: StrategyContext): Promise<StrategySignal>;
}

export interface SignalToIntentMapper {
  map(signal: StrategySignal, context: StrategyContext): OrderIntent | undefined;
}
