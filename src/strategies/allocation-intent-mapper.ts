import type { OrderIntent } from "../core/types.js";
import type { StrategyContext } from "../data/interfaces.js";
import type { SignalToIntentMapper, StrategySignal } from "./interfaces.js";

export interface AllocationIntentMapperConfig {
  accountEquity: number;
  targetAllocationPct: number;
  targetAllocationPctBySymbol?: Record<string, number>;
  maxNotionalPerTrade?: number;
  minNotionalPerTrade?: number;
}

export class AllocationIntentMapper implements SignalToIntentMapper {
  constructor(private readonly config: AllocationIntentMapperConfig) {
    if (!Number.isFinite(config.accountEquity) || config.accountEquity <= 0) {
      throw new Error("Allocation intent mapper accountEquity must be positive.");
    }

    if (
      !Number.isFinite(config.targetAllocationPct) ||
      config.targetAllocationPct <= 0 ||
      config.targetAllocationPct > 1
    ) {
      throw new Error("Allocation intent mapper targetAllocationPct must be between 0 and 1.");
    }

    for (const [symbol, targetAllocationPct] of Object.entries(
      config.targetAllocationPctBySymbol ?? {}
    )) {
      if (!symbol || symbol.trim().length === 0) {
        throw new Error(
          "Allocation intent mapper targetAllocationPctBySymbol keys must be symbols."
        );
      }

      if (
        !Number.isFinite(targetAllocationPct) ||
        targetAllocationPct <= 0 ||
        targetAllocationPct > 1
      ) {
        throw new Error(
          "Allocation intent mapper targetAllocationPctBySymbol values must be between 0 and 1."
        );
      }
    }

    if (
      config.maxNotionalPerTrade !== undefined &&
      (!Number.isFinite(config.maxNotionalPerTrade) || config.maxNotionalPerTrade <= 0)
    ) {
      throw new Error("Allocation intent mapper maxNotionalPerTrade must be positive.");
    }

    if (
      config.minNotionalPerTrade !== undefined &&
      (!Number.isFinite(config.minNotionalPerTrade) || config.minNotionalPerTrade < 0)
    ) {
      throw new Error("Allocation intent mapper minNotionalPerTrade must be non-negative.");
    }
  }

  map(signal: StrategySignal, context: StrategyContext): OrderIntent | undefined {
    if (signal.action === "hold") {
      return undefined;
    }

    const price = context.tick?.last ?? context.candles.at(-1)?.close;
    if (!price || price <= 0) {
      return undefined;
    }

    const currentPosition = context.positions.find((position) => position.symbol === signal.symbol);
    const currentQuantity = currentPosition?.quantity ?? 0;
    const currentNotional = currentQuantity * price;
    const targetAllocationPct = this.targetAllocationPct(signal.symbol);
    const targetNotional = this.config.accountEquity * targetAllocationPct;
    const rawNotional =
      signal.action === "buy"
        ? Math.max(0, targetNotional - Math.max(0, currentNotional))
        : Math.min(Math.abs(currentNotional), targetNotional);
    const notional = this.capNotional(rawNotional);

    if (notional <= 0 || notional < (this.config.minNotionalPerTrade ?? 0)) {
      return undefined;
    }

    return {
      symbol: signal.symbol,
      side: signal.action,
      type: "market",
      quantity: notional / price,
      limitPrice: price,
      reason: `${signal.reason} Allocation target ${(targetAllocationPct * 100).toFixed(
        2
      )}% of equity.`,
      strategyId: signal.strategyId
    };
  }

  private targetAllocationPct(symbol: string): number {
    return (
      this.config.targetAllocationPctBySymbol?.[symbol.toUpperCase()] ??
      this.config.targetAllocationPct
    );
  }

  private capNotional(notional: number): number {
    return this.config.maxNotionalPerTrade === undefined
      ? notional
      : Math.min(notional, this.config.maxNotionalPerTrade);
  }
}
