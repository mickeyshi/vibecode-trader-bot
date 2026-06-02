import type { Candle, MarketEvent, MarketTick } from "../core/types.js";
import type { EventStore, MarketDataStore } from "./interfaces.js";

export class InMemoryMarketDataStore implements MarketDataStore {
  private readonly ticks = new Map<string, MarketTick>();
  private readonly candles = new Map<string, Candle[]>();

  async saveTick(tick: MarketTick): Promise<void> {
    this.ticks.set(tick.symbol, tick);
  }

  async saveCandle(candle: Candle): Promise<void> {
    const candles = this.candles.get(candle.symbol) ?? [];
    candles.push(candle);
    candles.sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());
    this.candles.set(candle.symbol, candles);
  }

  async getRecentCandles(symbol: string, limit: number): Promise<Candle[]> {
    return [...(this.candles.get(symbol) ?? [])].slice(-limit);
  }

  async getLatestTick(symbol: string): Promise<MarketTick | undefined> {
    return this.ticks.get(symbol);
  }
}

export class InMemoryEventStore implements EventStore {
  private readonly events: MarketEvent[] = [];

  async saveEvent(event: MarketEvent): Promise<void> {
    this.events.push(event);
    this.events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  async getRecentEvents(symbol: string | undefined, limit: number): Promise<MarketEvent[]> {
    return this.events
      .filter(
        (event) => event.symbol === undefined || symbol === undefined || event.symbol === symbol
      )
      .slice(-limit);
  }
}
