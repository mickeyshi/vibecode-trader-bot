import type { StrategyContext } from "../data/interfaces.js";
import { hasLongPosition, relativeStrengthIndex } from "./indicators.js";
import type { Strategy, StrategySignal } from "./interfaces.js";

export interface RsiStrategyConfig {
  rsiWindow: number;
  oversoldThreshold: number;
  overboughtThreshold: number;
}

export class RsiStrategy implements Strategy {
  readonly id = "rsi-threshold";

  constructor(private readonly config: RsiStrategyConfig) {}

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const candles = context.candles.slice(-(this.config.rsiWindow + 1));
    const rsi = relativeStrengthIndex(candles);
    if (rsi === undefined || candles.length < this.config.rsiWindow + 1) {
      return signal(this.id, context, "hold", 0, "Not enough candles for RSI.");
    }

    if (rsi <= this.config.oversoldThreshold) {
      return signal(
        this.id,
        context,
        "buy",
        confidence(rsi, this.config.oversoldThreshold),
        `RSI ${rsi.toFixed(2)} is oversold.`
      );
    }

    if (
      hasLongPosition(context.positions, context.symbol) &&
      rsi >= this.config.overboughtThreshold
    ) {
      return signal(
        this.id,
        context,
        "sell",
        confidence(rsi, this.config.overboughtThreshold),
        `RSI ${rsi.toFixed(2)} is overbought.`
      );
    }

    return signal(this.id, context, "hold", 0, "RSI inside thresholds.");
  }
}

function confidence(rsi: number, threshold: number): number {
  return Math.min(Math.abs(rsi - threshold) / 30, 1);
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
