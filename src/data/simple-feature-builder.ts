import type { PortfolioStore } from "../portfolio/interfaces.js";
import type {
  EventStore,
  FeatureBuilder,
  MarketDataStore,
  StrategyContext,
  StrategyFeatures
} from "./interfaces.js";

export interface SimpleFeatureBuilderConfig {
  candleLimit: number;
  eventLimit: number;
}

export class SimpleFeatureBuilder implements FeatureBuilder {
  constructor(
    private readonly marketDataStore: MarketDataStore,
    private readonly eventStore: EventStore,
    private readonly portfolioStore: PortfolioStore,
    private readonly config: SimpleFeatureBuilderConfig = { candleLimit: 50, eventLimit: 20 }
  ) {}

  async buildContext(symbol: string): Promise<StrategyContext> {
    const candles = await this.marketDataStore.getRecentCandles(symbol, this.config.candleLimit);
    const events = await this.eventStore.getRecentEvents(symbol, this.config.eventLimit);
    const positions = await this.portfolioStore.getOpenPositions();
    const tick = await this.marketDataStore.getLatestTick(symbol);

    const features: StrategyFeatures = {};
    setFeature(features, "momentum", calculateMomentum(candles));
    setFeature(features, "volatility", calculateVolatility(candles));
    setFeature(features, "newsSentiment", calculateNewsSentiment(events));

    return {
      symbol,
      candles,
      events,
      positions,
      features,
      now: tick?.timestamp ?? candles.at(-1)?.closeTime ?? new Date(),
      ...(tick ? { tick } : {})
    };
  }
}

function setFeature<K extends keyof StrategyFeatures>(
  features: StrategyFeatures,
  key: K,
  value: StrategyFeatures[K] | undefined
): void {
  if (value !== undefined) {
    features[key] = value;
  }
}

function calculateMomentum(candles: { close: number }[]): number | undefined {
  const first = candles.at(0);
  const last = candles.at(-1);
  if (!first || !last || first.close === 0) {
    return undefined;
  }

  return (last.close - first.close) / first.close;
}

function calculateVolatility(candles: { close: number }[]): number | undefined {
  if (candles.length < 2) {
    return undefined;
  }

  const returns = candles.slice(1).map((candle, index) => {
    const previous = candles[index];
    return previous && previous.close !== 0 ? (candle.close - previous.close) / previous.close : 0;
  });
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / returns.length;

  return Math.sqrt(variance);
}

function calculateNewsSentiment(
  events: { sentiment?: "positive" | "neutral" | "negative"; importance: number }[]
): number | undefined {
  const scoredEvents = events.filter((event) => event.sentiment);
  if (scoredEvents.length === 0) {
    return undefined;
  }

  const totalWeight = scoredEvents.reduce((sum, event) => sum + event.importance, 0);
  if (totalWeight === 0) {
    return 0;
  }

  return (
    scoredEvents.reduce((sum, event) => {
      const score = event.sentiment === "positive" ? 1 : event.sentiment === "negative" ? -1 : 0;
      return sum + score * event.importance;
    }, 0) / totalWeight
  );
}
