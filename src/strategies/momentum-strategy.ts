import type { StrategyContext } from "../data/interfaces.js";
import { closeMomentum, hasLongPosition } from "./indicators.js";
import type { Strategy, StrategySignal } from "./interfaces.js";

export interface MomentumStrategyConfig {
  lookbackWindow: number;
  buyThresholdPct: number;
  sellThresholdPct: number;
}

export class MomentumStrategy implements Strategy {
  readonly id = "momentum";

  constructor(private readonly config: MomentumStrategyConfig) {}

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const candles = context.candles.slice(-this.config.lookbackWindow);
    const momentum = closeMomentum(candles);
    if (momentum === undefined || candles.length < this.config.lookbackWindow) {
      return signal(this.id, context, "hold", 0, "Not enough candles for momentum.");
    }

    const momentumPct = momentum * 100;
    if (momentumPct >= this.config.buyThresholdPct) {
      return signal(
        this.id,
        context,
        "buy",
        confidence(momentumPct),
        `Momentum ${momentumPct.toFixed(2)}% exceeds buy threshold.`
      );
    }

    if (
      hasLongPosition(context.positions, context.symbol) &&
      momentumPct <= -Math.abs(this.config.sellThresholdPct)
    ) {
      return signal(
        this.id,
        context,
        "sell",
        confidence(momentumPct),
        `Momentum ${momentumPct.toFixed(2)}% breached sell threshold.`
      );
    }

    return signal(this.id, context, "hold", confidence(momentumPct), "Momentum inside thresholds.");
  }
}

function confidence(valuePct: number): number {
  return Math.min(Math.abs(valuePct) / 10, 1);
}

function signal(
  strategyId: string,
  context: StrategyContext,
  action: StrategySignal["action"],
  confidenceValue: number,
  reason: string
): StrategySignal {
  return {
    strategyId,
    symbol: context.symbol,
    action,
    confidence: confidenceValue,
    reason,
    createdAt: context.now
  };
}
