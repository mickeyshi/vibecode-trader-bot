import type { OrderIntent } from "../core/types.js";
import type { StrategyContext } from "../data/interfaces.js";
import type { SignalToIntentMapper, StrategySignal } from "./interfaces.js";

export interface FixedNotionalIntentMapperConfig {
  notionalPerTrade: number;
}

export class FixedNotionalIntentMapper implements SignalToIntentMapper {
  constructor(private readonly config: FixedNotionalIntentMapperConfig) {}

  map(signal: StrategySignal, context: StrategyContext): OrderIntent | undefined {
    if (signal.action === "hold") {
      return undefined;
    }

    const price = context.tick?.last ?? context.candles.at(-1)?.close;
    if (!price || price <= 0) {
      return undefined;
    }

    return {
      symbol: signal.symbol,
      side: signal.action,
      type: "market",
      quantity: this.config.notionalPerTrade / price,
      limitPrice: price,
      reason: signal.reason,
      strategyId: signal.strategyId
    };
  }
}
