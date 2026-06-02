import type { Candle, MarketTick } from "../core/types.js";
import { InMemoryEventStore, InMemoryMarketDataStore } from "../data/in-memory-stores.js";
import { SimpleFeatureBuilder } from "../data/simple-feature-builder.js";
import { PaperOrderExecutor } from "../execution/paper-order-executor.js";
import { InMemoryPortfolioStore } from "../portfolio/in-memory-portfolio-store.js";
import { BasicRiskEngine } from "../risk/basic-risk-engine.js";
import type { RiskEngine } from "../risk/interfaces.js";
import { FixedNotionalIntentMapper } from "../strategies/fixed-notional-intent-mapper.js";
import type { SignalToIntentMapper, Strategy } from "../strategies/interfaces.js";
import type {
  BacktestReport,
  BacktestRequest,
  Backtester,
  BacktestRiskRejection
} from "./interfaces.js";

export interface SimpleBacktesterConfig {
  strategy: Strategy;
  mapper?: SignalToIntentMapper;
  riskEngine?: RiskEngine;
}

export class SimpleBacktester implements Backtester {
  constructor(private readonly config: SimpleBacktesterConfig) {}

  async run(request: BacktestRequest): Promise<BacktestReport> {
    // The first-pass backtester uses in-memory stores so the full pipeline can run without
    // choosing a database, broker SDK, queue, or cloud service.
    const marketStore = new InMemoryMarketDataStore();
    const eventStore = new InMemoryEventStore();
    const portfolioStore = new InMemoryPortfolioStore(request.startingEquity);

    // The feature builder turns raw stored market data plus portfolio state into the single
    // StrategyContext object that strategies consume.
    const featureBuilder = new SimpleFeatureBuilder(marketStore, eventStore, portfolioStore);

    // Defaults keep the demo usable, but callers can inject their own mapper or risk engine
    // when they want to test different sizing or risk behavior.
    const mapper =
      this.config.mapper ??
      new FixedNotionalIntentMapper({ notionalPerTrade: request.startingEquity * 0.1 });
    const riskEngine =
      this.config.riskEngine ??
      new BasicRiskEngine({
        maxOrderNotional: request.startingEquity * 0.2,
        maxPositionNotional: request.startingEquity * 0.5,
        maxDailyLossPct: 0.05,
        blockHighImpactEventsAtOrAbove: 10,
        maxGrossLeverage: 1
      });

    // Paper execution simulates fills using the latest known tick. In this backtester, that
    // tick is created from the current candle close, so fills are intentionally optimistic.
    const executor = new PaperOrderExecutor(
      portfolioStore,
      async (symbol) => {
        const tick = await marketStore.getLatestTick(symbol);
        if (!tick) {
          throw new Error(`No latest tick for ${symbol}.`);
        }
        return tick.last;
      },
      { feeRate: request.feeRate, slippageBps: request.slippageBps }
    );

    const equityCurve: number[] = [request.startingEquity];
    const riskRejections: BacktestRiskRejection[] = [];
    const candles = [...request.candles].sort(
      (a, b) => a.closeTime.getTime() - b.closeTime.getTime()
    );

    for (const candle of candles) {
      // Replay each historical candle into the same stores that a live feed would update.
      // This lets strategy/risk code read market state without knowing whether it is in
      // backtest, paper, or live mode.
      await marketStore.saveCandle(candle);
      await marketStore.saveTick(toTick(candle));
      portfolioStore.markPrice(candle.symbol, candle.close, candle.closeTime);

      // A single fixture can contain multiple symbols. Only requested symbols are evaluated,
      // though every candle still updates market/portfolio state above.
      if (!request.symbols.includes(candle.symbol)) {
        continue;
      }

      // Strategy evaluation is deliberately separated from order construction. Strategies say
      // "buy/sell/hold"; the mapper decides what concrete order intent that implies.
      const context = await featureBuilder.buildContext(candle.symbol);
      const signal = await this.config.strategy.evaluate(context);
      const intent = mapper.map(signal, context);

      if (intent) {
        const account = await portfolioStore.getAccountSnapshot();

        // Risk is the last gate before execution. In this first pass, dailyRealizedPnl is a
        // placeholder; portfolio accounting needs realized PnL before that rule is meaningful.
        const decision = await riskEngine.evaluate(intent, {
          mode: "backtest",
          openPositions: await portfolioStore.getOpenPositions(),
          recentEvents: context.events,
          dailyRealizedPnl: account.realizedPnl,
          accountEquity: account.equity,
          cash: account.cash,
          buyingPower: account.buyingPower,
          now: context.now
        });

        if (decision.approved && decision.intent) {
          await executor.placeOrder(decision.intent);
        } else {
          riskRejections.push({
            intent,
            reason: decision.reason,
            appliedRules: decision.appliedRules,
            timestamp: context.now
          });
        }
      }

      // Capture equity after each replayed candle so drawdown can be computed at the end.
      equityCurve.push((await portfolioStore.getAccountSnapshot()).equity);
    }

    const finalSnapshot = await portfolioStore.getAccountSnapshot();
    const firstCandle = candles.at(0);
    const lastCandle = candles.at(-1);

    return {
      strategyId: request.strategyId,
      start: firstCandle?.openTime ?? new Date(0),
      end: lastCandle?.closeTime ?? new Date(0),
      endingEquity: finalSnapshot.equity,
      totalReturnPct:
        ((finalSnapshot.equity - request.startingEquity) / request.startingEquity) * 100,
      maxDrawdownPct: calculateMaxDrawdownPct(equityCurve),
      orders: portfolioStore.getOrders(),
      fills: portfolioStore.getFills(),
      riskRejections,
      assumptions: [
        "Orders fill immediately at the latest candle close.",
        `Fee rate: ${request.feeRate}.`,
        `Slippage: ${request.slippageBps} bps.`
      ]
    };
  }
}

function toTick(candle: Candle): MarketTick {
  // The current strategy path expects a latest tick. Daily or minute candles are therefore
  // adapted into a simple tick using the candle close as the latest price.
  return {
    symbol: candle.symbol,
    last: candle.close,
    volume: candle.volume,
    timestamp: candle.closeTime
  };
}

function calculateMaxDrawdownPct(equityCurve: number[]): number {
  // Drawdown measures the worst peak-to-trough equity decline observed during the run.
  let peak = equityCurve[0] ?? 0;
  let maxDrawdown = 0;

  for (const equity of equityCurve) {
    peak = Math.max(peak, equity);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }
  }

  return maxDrawdown * 100;
}
