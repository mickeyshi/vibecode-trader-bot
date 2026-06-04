import type { StrategyContext } from "../data/interfaces.js";
import { averageClose, closeMomentum, hasLongPosition } from "./indicators.js";
import type { Strategy, StrategySignal } from "./interfaces.js";

export interface ScoredContextStrategyConfig {
  momentumWindow: number;
  trendWindow: number;
  buyScore: number;
  sellScore: number;
  highVolatilityThreshold: number;
}

export class ScoredContextStrategy implements Strategy {
  readonly id = "scored-context";

  constructor(private readonly config: ScoredContextStrategyConfig) {}

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const latest = context.candles.at(-1);
    const trendCandles = context.candles.slice(-this.config.trendWindow);
    const momentum = closeMomentum(context.candles.slice(-this.config.momentumWindow));
    if (!latest || momentum === undefined || trendCandles.length < this.config.trendWindow) {
      return signal(this.id, context, "hold", 0, "Not enough context for scoring.");
    }

    const reasons: string[] = [];
    let score = 0;
    const trendAverage = averageClose(trendCandles);
    if (momentum > 0) {
      score += 2;
      reasons.push("positive momentum");
    } else {
      score -= 2;
      reasons.push("negative momentum");
    }

    if (latest.close > trendAverage) {
      score += 1;
      reasons.push("above trend average");
    } else {
      score -= 1;
      reasons.push("below trend average");
    }

    if ((context.features.volatility ?? 0) > this.config.highVolatilityThreshold) {
      score -= 2;
      reasons.push("high volatility");
    }

    const newsSentiment = context.features.newsSentiment ?? 0;
    if (newsSentiment > 0) {
      score += 1;
      reasons.push("positive event sentiment");
    } else if (newsSentiment < 0) {
      score -= 1;
      reasons.push("negative event sentiment");
    }

    if (score >= this.config.buyScore) {
      return signal(
        this.id,
        context,
        "buy",
        confidence(score),
        `Score ${score}: ${reasons.join(", ")}.`
      );
    }

    if (hasLongPosition(context.positions, context.symbol) && score <= this.config.sellScore) {
      return signal(
        this.id,
        context,
        "sell",
        confidence(score),
        `Score ${score}: ${reasons.join(", ")}.`
      );
    }

    return signal(
      this.id,
      context,
      "hold",
      confidence(score),
      `Score ${score}: ${reasons.join(", ")}.`
    );
  }
}

function confidence(score: number): number {
  return Math.min(Math.abs(score) / 6, 1);
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
