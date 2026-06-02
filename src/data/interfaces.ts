import type { Candle, MarketEvent, MarketTick, Position } from "../core/types.js";

export interface MarketDataStore {
  saveTick(tick: MarketTick): Promise<void>;
  saveCandle(candle: Candle): Promise<void>;
  getRecentCandles(symbol: string, limit: number): Promise<Candle[]>;
  getLatestTick(symbol: string): Promise<MarketTick | undefined>;
}

export interface EventStore {
  saveEvent(event: MarketEvent): Promise<void>;
  getRecentEvents(symbol: string | undefined, limit: number): Promise<MarketEvent[]>;
}

export interface StrategyFeatures {
  volatility?: number;
  momentum?: number;
  newsSentiment?: number;
  liquidityScore?: number;
}

export interface StrategyContext {
  symbol: string;
  tick?: MarketTick;
  candles: Candle[];
  events: MarketEvent[];
  positions: Position[];
  features: StrategyFeatures;
  now: Date;
}

export interface FeatureBuilder {
  buildContext(symbol: string): Promise<StrategyContext>;
}
