import type { Candle, MarketTick } from "../core/types.js";
import { InMemoryEventStore, InMemoryMarketDataStore } from "../data/in-memory-stores.js";
import { SimpleFeatureBuilder } from "../data/simple-feature-builder.js";
import type { PaperOrderExecutorConfig } from "../execution/paper-order-executor.js";
import { PaperOrderExecutor } from "../execution/paper-order-executor.js";
import { InMemoryPortfolioStore } from "../portfolio/in-memory-portfolio-store.js";
import type { AccountSnapshot } from "../portfolio/interfaces.js";
import { BasicRiskEngine, type BasicRiskConfig } from "../risk/basic-risk-engine.js";
import type { RiskEngine } from "../risk/interfaces.js";
import { FixedNotionalIntentMapper } from "../strategies/fixed-notional-intent-mapper.js";
import type { SignalToIntentMapper, Strategy } from "../strategies/interfaces.js";
import { createMarketCalendar } from "./market-calendars.js";
import type {
  BacktestDataQualityWarning,
  BacktestEquityPoint,
  BacktestRequest,
  BacktestRiskRejection
} from "./interfaces.js";

export interface CandleReplayEngineConfig {
  strategy: Strategy;
  mapper?: SignalToIntentMapper;
  riskEngine?: RiskEngine;
}

export interface CandleReplayRequest {
  symbols: string[];
  candles: Candle[];
  startingEquity: number;
  execution: PaperOrderExecutorConfig;
  riskDefaults: BasicRiskConfig;
  notionalPerTrade: number;
  maxDataGapDays: number;
  marketCalendar?: BacktestRequest["marketCalendar"];
  marketHolidays?: string[];
}

export interface CandleReplayResult {
  candles: Candle[];
  finalSnapshot: AccountSnapshot;
  orders: ReturnType<InMemoryPortfolioStore["getOrders"]>;
  fills: ReturnType<InMemoryPortfolioStore["getFills"]>;
  equityCurve: BacktestEquityPoint[];
  riskRejections: BacktestRiskRejection[];
  dataQualityWarnings: BacktestDataQualityWarning[];
  assumptions: string[];
}

export class CandleReplayEngine {
  constructor(private readonly config: CandleReplayEngineConfig) {}

  async run(request: CandleReplayRequest): Promise<CandleReplayResult> {
    const marketStore = new InMemoryMarketDataStore();
    const eventStore = new InMemoryEventStore();
    const portfolioStore = new InMemoryPortfolioStore(request.startingEquity);
    const featureBuilder = new SimpleFeatureBuilder(marketStore, eventStore, portfolioStore);
    const mapper =
      this.config.mapper ??
      new FixedNotionalIntentMapper({ notionalPerTrade: request.notionalPerTrade });
    const riskEngine = this.config.riskEngine ?? new BasicRiskEngine(request.riskDefaults);
    const executor = new PaperOrderExecutor(
      portfolioStore,
      async (symbol) => {
        const tick = await marketStore.getLatestTick(symbol);
        if (!tick) {
          throw new Error(`No latest tick for ${symbol}.`);
        }
        return tick.last;
      },
      request.execution
    );

    const equityCurve: BacktestEquityPoint[] = [
      {
        timestamp: request.candles.at(0)?.openTime ?? new Date(0),
        equity: request.startingEquity
      }
    ];
    const riskRejections: BacktestRiskRejection[] = [];
    const candles = [...request.candles].sort(
      (a, b) => a.closeTime.getTime() - b.closeTime.getTime()
    );
    const marketCalendar = createMarketCalendar({
      ...(request.marketCalendar !== undefined ? { marketCalendar: request.marketCalendar } : {}),
      ...(request.marketHolidays !== undefined ? { marketHolidays: request.marketHolidays } : {})
    });
    const dataQualityWarnings = detectDataQualityWarnings(
      candles,
      request.maxDataGapDays,
      marketCalendar
    );

    for (const candle of candles) {
      await marketStore.saveCandle(candle);
      await marketStore.saveTick(toTick(candle));
      portfolioStore.markPrice(candle.symbol, candle.close, candle.closeTime);

      if (!request.symbols.includes(candle.symbol)) {
        equityCurve.push({
          timestamp: candle.closeTime,
          equity: (await portfolioStore.getAccountSnapshot()).equity
        });
        continue;
      }

      const context = await featureBuilder.buildContext(candle.symbol);
      const signal = await this.config.strategy.evaluate(context);
      const intent = mapper.map(signal, context);

      if (intent) {
        const account = await portfolioStore.getAccountSnapshot();
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

      equityCurve.push({
        timestamp: candle.closeTime,
        equity: (await portfolioStore.getAccountSnapshot()).equity
      });
    }

    return {
      candles,
      finalSnapshot: await portfolioStore.getAccountSnapshot(),
      orders: portfolioStore.getOrders(),
      fills: portfolioStore.getFills(),
      equityCurve,
      riskRejections,
      dataQualityWarnings,
      assumptions: [
        "Orders fill immediately at the latest candle close.",
        `Fee rate: ${request.execution.feeRate}.`,
        `Slippage: ${request.execution.slippageBps} bps.`,
        `Spread: ${request.execution.spreadBps ?? 0} bps.`,
        `Fill ratio: ${request.execution.fillRatio ?? 1}.`,
        `Skip fill every: ${request.execution.skipFillEvery ?? "never"}.`,
        `Missing data gap threshold: ${request.maxDataGapDays} days.`,
        `Market calendar: ${marketCalendar.id}.`,
        `Configured market holidays: ${(request.marketHolidays ?? []).length}.`
      ]
    };
  }
}

function toTick(candle: Candle): MarketTick {
  return {
    symbol: candle.symbol,
    last: candle.close,
    volume: candle.volume,
    timestamp: candle.closeTime
  };
}

function detectDataQualityWarnings(
  candles: Candle[],
  maxDataGapDays: number,
  marketCalendar: ReturnType<typeof createMarketCalendar>
): BacktestDataQualityWarning[] {
  const warnings: BacktestDataQualityWarning[] = [];
  const previousBySymbol = new Map<string, Candle>();
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  for (const candle of candles) {
    const previous = previousBySymbol.get(candle.symbol);
    if (previous) {
      const gapDays =
        (candle.closeTime.getTime() - previous.closeTime.getTime()) / millisecondsPerDay;
      const missingSessionCount = marketCalendar.countMissingSessions(
        previous.closeTime,
        candle.closeTime
      );
      if (gapDays > maxDataGapDays && missingSessionCount > 0) {
        warnings.push({
          type: "missing-data-gap",
          symbol: candle.symbol,
          calendar: marketCalendar.id,
          previousTimestamp: previous.closeTime,
          currentTimestamp: candle.closeTime,
          gapDays,
          missingSessionCount,
          message: `${candle.symbol} has a ${gapDays.toFixed(2)} day candle gap with ${missingSessionCount} missing ${marketCalendar.id} session(s).`
        });
      }
    }

    previousBySymbol.set(candle.symbol, candle);
  }

  return warnings;
}
