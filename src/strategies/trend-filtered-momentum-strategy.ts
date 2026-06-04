import type { StrategyContext } from "../data/interfaces.js";
import { averageClose, closeMomentum, hasLongPosition } from "./indicators.js";
import type { Strategy, StrategySignal } from "./interfaces.js";

export interface TrendFilteredMomentumStrategyConfig {
  momentumWindow: number;
  trendWindow: number;
  momentumThresholdPct: number;
}

export class TrendFilteredMomentumStrategy implements Strategy {
  readonly id = "trend-filtered-momentum";

  constructor(private readonly config: TrendFilteredMomentumStrategyConfig) {}

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const trendCandles = context.candles.slice(-this.config.trendWindow);
    const momentumCandles = context.candles.slice(-this.config.momentumWindow);
    const latest = context.candles.at(-1);
    const momentum = closeMomentum(momentumCandles);

    if (!latest || momentum === undefined || trendCandles.length < this.config.trendWindow) {
      return signal(this.id, context, "hold", 0, "Not enough candles for trend-filtered momentum.");
    }

    const trendAverage = averageClose(trendCandles);
    const momentumPct = momentum * 100;
    const aboveTrend = latest.close > trendAverage;

    if (aboveTrend && momentumPct >= this.config.momentumThresholdPct) {
      return signal(
        this.id,
        context,
        "buy",
        Math.min(momentumPct / 10, 1),
        `Momentum ${momentumPct.toFixed(2)}% with price above trend average.`
      );
    }

    if (hasLongPosition(context.positions, context.symbol) && (!aboveTrend || momentumPct < 0)) {
      return signal(this.id, context, "sell", 0.5, "Trend filter or momentum turned negative.");
    }

    return signal(
      this.id,
      context,
      "hold",
      Math.min(Math.abs(momentumPct) / 10, 1),
      "Trend-filtered momentum inactive."
    );
  }
}

function signal(
  strategyId: string,
  context: StrategyContext,
  action: StrategySignal["action"],
  confidence: number,
  reason: string
): StrategySignal {
  return {
    strategyId,
    symbol: context.symbol,
    action,
    confidence,
    reason,
    createdAt: context.now
  };
}
