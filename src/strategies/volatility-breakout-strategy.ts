import type { StrategyContext } from "../data/interfaces.js";
import { hasLongPosition } from "./indicators.js";
import type { Strategy, StrategySignal } from "./interfaces.js";

export interface VolatilityBreakoutStrategyConfig {
  lookbackWindow: number;
  breakoutPct: number;
}

export class VolatilityBreakoutStrategy implements Strategy {
  readonly id = "volatility-breakout";

  constructor(private readonly config: VolatilityBreakoutStrategyConfig) {}

  async evaluate(context: StrategyContext): Promise<StrategySignal> {
    const candles = context.candles.slice(-(this.config.lookbackWindow + 1));
    const latest = candles.at(-1);
    const prior = candles.slice(0, -1);
    if (!latest || prior.length < this.config.lookbackWindow) {
      return signal(this.id, context, "hold", 0, "Not enough candles for breakout.");
    }

    const priorHigh = Math.max(...prior.map((candle) => candle.high));
    const priorLow = Math.min(...prior.map((candle) => candle.low));
    const breakoutLevel = priorHigh * (1 + this.config.breakoutPct / 100);

    if (latest.close > breakoutLevel) {
      const movePct = ((latest.close - priorHigh) / priorHigh) * 100;
      return signal(
        this.id,
        context,
        "buy",
        Math.min(movePct / 10, 1),
        `Close broke above ${this.config.lookbackWindow}-candle high by ${movePct.toFixed(2)}%.`
      );
    }

    if (hasLongPosition(context.positions, context.symbol) && latest.close < priorLow) {
      return signal(this.id, context, "sell", 0.5, "Close broke below recent low.");
    }

    return signal(this.id, context, "hold", 0, "No breakout.");
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
