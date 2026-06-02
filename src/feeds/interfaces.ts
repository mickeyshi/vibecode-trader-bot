import type { MarketEvent, MarketTick } from "../core/types.js";

export interface MarketFeed {
  readonly id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(symbols: string[]): Promise<void>;
  onTick(handler: (tick: MarketTick) => void): void;
}

export interface EventFeed {
  readonly id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(topics: string[]): Promise<void>;
  onEvent(handler: (event: MarketEvent) => void): void;
}

export interface FeedManager {
  start(): Promise<void>;
  stop(): Promise<void>;
}
