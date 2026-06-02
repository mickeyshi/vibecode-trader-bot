import type { StrategyContext } from "../data/interfaces.js";
import type { Strategy, StrategySignal } from "./interfaces.js";

export interface MovingAverageCrossoverConfig {
  shortWindow: number;
  longWindow: number;
  minConfidence: number;
}

export class MovingAverageCrossoverStrategy implements Strategy {
  readonly id = "moving-average-crossover";

  constructor(private readonly config: MovingAverageCrossoverConfig) {
    if (config.shortWindow >= config.longWindow) {
      throw new Error("shortWindow must be smaller than longWindow.");
    }
  }

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    if (context.candles.length < this.config.longWindow) {
      return this.signal(context, "hold", 0, "Not enough candles.");
    }

    const shortAverage = averageClose(context.candles.slice(-this.config.shortWindow));
    const longAverage = averageClose(context.candles.slice(-this.config.longWindow));
    const spread = (shortAverage - longAverage) / longAverage;
    const confidence = Math.min(Math.abs(spread) * 100, 1);

    if (confidence < this.config.minConfidence) {
      return this.signal(context, "hold", confidence, "Moving-average spread below threshold.");
    }

    return this.signal(
      context,
      spread > 0 ? "buy" : "sell",
      confidence,
      `Short MA ${shortAverage.toFixed(4)} ${spread > 0 ? "above" : "below"} long MA ${longAverage.toFixed(4)}.`
    );
  }

  private signal(
    context: StrategyContext,
    action: StrategySignal["action"],
    confidence: number,
    reason: string
  ): StrategySignal {
    return {
      strategyId: this.id,
      symbol: context.symbol,
      action,
      confidence,
      reason,
      createdAt: context.now
    };
  }
}

function averageClose(candles: { close: number }[]): number {
  return candles.reduce((sum, candle) => sum + candle.close, 0) / candles.length;
}
