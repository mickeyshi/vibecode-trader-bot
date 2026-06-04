import type { Candle, Position } from "../core/types.js";

export function averageClose(candles: Pick<Candle, "close">[]): number {
  return candles.reduce((sum, candle) => sum + candle.close, 0) / candles.length;
}

export function closeMomentum(candles: Pick<Candle, "close">[]): number | undefined {
  const first = candles.at(0);
  const last = candles.at(-1);
  if (!first || !last || first.close === 0) {
    return undefined;
  }

  return (last.close - first.close) / first.close;
}

export function standardDeviation(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function relativeStrengthIndex(candles: Pick<Candle, "close">[]): number | undefined {
  if (candles.length < 2) {
    return undefined;
  }

  let gains = 0;
  let losses = 0;

  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index]!;
    const previous = candles[index - 1]!;
    const change = current.close - previous.close;
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) {
    return 100;
  }

  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

export function hasLongPosition(positions: Position[], symbol: string): boolean {
  return positions.some((position) => position.symbol === symbol && position.quantity > 0);
}
