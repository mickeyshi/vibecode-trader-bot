import type { StrategyContext } from "../data/interfaces.js";
import { averageClose, hasLongPosition, standardDeviation } from "./indicators.js";
import type { Strategy, StrategySignal } from "./interfaces.js";

export interface MeanReversionStrategyConfig {
  lookbackWindow: number;
  entryZScore: number;
  exitZScore: number;
}

export class MeanReversionStrategy implements Strategy {
  readonly id = "mean-reversion";

  constructor(private readonly config: MeanReversionStrategyConfig) {}

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const candles = context.candles.slice(-this.config.lookbackWindow);
    const latest = candles.at(-1);
    if (!latest || candles.length < this.config.lookbackWindow) {
      return signal(this.id, context, "hold", 0, "Not enough candles for mean reversion.");
    }

    const mean = averageClose(candles);
    const deviation = standardDeviation(candles.map((candle) => candle.close));
    if (deviation === 0) {
      return signal(this.id, context, "hold", 0, "No price deviation.");
    }

    const zScore = (latest.close - mean) / deviation;
    if (zScore <= -Math.abs(this.config.entryZScore)) {
      return signal(
        this.id,
        context,
        "buy",
        confidence(zScore),
        `Close is ${zScore.toFixed(2)} standard deviations below mean.`
      );
    }

    if (hasLongPosition(context.positions, context.symbol) && zScore >= this.config.exitZScore) {
      return signal(
        this.id,
        context,
        "sell",
        confidence(zScore),
        `Close reverted to z-score ${zScore.toFixed(2)}.`
      );
    }

    return signal(
      this.id,
      context,
      "hold",
      confidence(zScore),
      "Mean-reversion z-score inside thresholds."
    );
  }
}

function confidence(zScore: number): number {
  return Math.min(Math.abs(zScore) / 3, 1);
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
