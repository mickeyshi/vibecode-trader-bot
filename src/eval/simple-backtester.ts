import type { Candle, Fill, MarketTick } from "../core/types.js";
import { InMemoryEventStore, InMemoryMarketDataStore } from "../data/in-memory-stores.js";
import { SimpleFeatureBuilder } from "../data/simple-feature-builder.js";
import { PaperOrderExecutor } from "../execution/paper-order-executor.js";
import { InMemoryPortfolioStore } from "../portfolio/in-memory-portfolio-store.js";
import { BasicRiskEngine } from "../risk/basic-risk-engine.js";
import type { RiskEngine } from "../risk/interfaces.js";
import { FixedNotionalIntentMapper } from "../strategies/fixed-notional-intent-mapper.js";
import type { SignalToIntentMapper, Strategy } from "../strategies/interfaces.js";
import { createMarketCalendar } from "./market-calendars.js";
import type {
  BacktestReport,
  BacktestRequest,
  Backtester,
  BacktestDataQualityWarning,
  BacktestEquityPoint,
  BacktestRiskRejection,
  BacktestTrade
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
        maxGrossLeverage: 1,
        estimatedFeeRate: request.feeRate,
        estimatedSlippageBps: request.slippageBps,
        estimatedSpreadBps: request.spreadBps ?? 0
      });

    // Paper execution simulates fills using the latest known tick. In this backtester, that
    // tick is created from the current candle close, so fills are intentionally optimistic.
    const executorConfig = {
      feeRate: request.feeRate,
      slippageBps: request.slippageBps,
      spreadBps: request.spreadBps ?? 0,
      fillRatio: request.fillRatio ?? 1,
      ...(request.skipFillEvery !== undefined ? { skipFillEvery: request.skipFillEvery } : {})
    };
    const executor = new PaperOrderExecutor(
      portfolioStore,
      async (symbol) => {
        const tick = await marketStore.getLatestTick(symbol);
        if (!tick) {
          throw new Error(`No latest tick for ${symbol}.`);
        }
        return tick.last;
      },
      executorConfig
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
      request.maxDataGapDays ?? 4,
      marketCalendar
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
      equityCurve.push({
        timestamp: candle.closeTime,
        equity: (await portfolioStore.getAccountSnapshot()).equity
      });
    }

    const finalSnapshot = await portfolioStore.getAccountSnapshot();
    const firstCandle = candles.at(0);
    const lastCandle = candles.at(-1);
    const orders = portfolioStore.getOrders();
    const fills = portfolioStore.getFills();
    const totalFees = fills.reduce((sum, fill) => sum + fill.fee, 0);
    const trades = calculateClosedTrades(fills);
    const tradeMetrics = calculateClosedTradeMetrics(trades);

    return {
      strategyId: request.strategyId,
      start: firstCandle?.openTime ?? new Date(0),
      end: lastCandle?.closeTime ?? new Date(0),
      endingEquity: finalSnapshot.equity,
      totalReturnPct:
        ((finalSnapshot.equity - request.startingEquity) / request.startingEquity) * 100,
      maxDrawdownPct: calculateMaxDrawdownPct(equityCurve),
      orders,
      fills,
      trades,
      riskRejections,
      equityCurve,
      metrics: {
        startingEquity: request.startingEquity,
        endingEquity: finalSnapshot.equity,
        endingCash: finalSnapshot.cash,
        finalPositionValue: finalSnapshot.positionValue,
        finalGrossExposure: finalSnapshot.grossExposure,
        finalRealizedPnl: finalSnapshot.realizedPnl,
        finalUnrealizedPnl: finalSnapshot.unrealizedPnl,
        netProfit: finalSnapshot.equity - request.startingEquity,
        totalFees,
        filledOrderCount: fills.length,
        skippedOrderCount: orders.filter((order) => order.status === "cancelled").length,
        ...tradeMetrics
      },
      dataQualityWarnings,
      assumptions: [
        "Orders fill immediately at the latest candle close.",
        `Fee rate: ${request.feeRate}.`,
        `Slippage: ${request.slippageBps} bps.`,
        `Spread: ${request.spreadBps ?? 0} bps.`,
        `Fill ratio: ${request.fillRatio ?? 1}.`,
        `Skip fill every: ${request.skipFillEvery ?? "never"}.`,
        `Missing data gap threshold: ${request.maxDataGapDays ?? 4} days.`,
        `Market calendar: ${marketCalendar.id}.`,
        `Configured market holidays: ${(request.marketHolidays ?? []).length}.`
      ]
    };
  }
}

function calculateClosedTrades(fills: Fill[]): BacktestTrade[] {
  let openQuantity = 0;
  let openCost = 0;
  let openEntryFees = 0;
  let entryTimestamp: Date | undefined;
  let nextTradeNumber = 1;
  const trades: BacktestTrade[] = [];

  for (const fill of fills) {
    if (fill.side === "buy") {
      openQuantity += fill.quantity;
      openCost += fill.price * fill.quantity + fill.fee;
      openEntryFees += fill.fee;
      entryTimestamp ??= fill.timestamp;
      continue;
    }

    const closedQuantity = Math.min(openQuantity, fill.quantity);
    if (closedQuantity <= 0 || !entryTimestamp) {
      continue;
    }

    const averageEntryPrice = openCost / openQuantity;
    const entryCost = averageEntryPrice * closedQuantity;
    const exitProceeds = fill.price * closedQuantity;
    const allocatedEntryFees = openEntryFees * (closedQuantity / openQuantity);
    const allocatedExitFee = fill.fee * (closedQuantity / fill.quantity);
    const pnl = exitProceeds - allocatedExitFee - entryCost;

    trades.push({
      id: `trade-${nextTradeNumber++}`,
      symbol: fill.symbol,
      side: "long",
      entryTimestamp,
      exitTimestamp: fill.timestamp,
      quantity: closedQuantity,
      averageEntryPrice,
      exitPrice: fill.price,
      entryCost,
      exitProceeds,
      fees: allocatedEntryFees + allocatedExitFee,
      pnl,
      returnPct: entryCost === 0 ? 0 : (pnl / entryCost) * 100
    });

    openQuantity -= closedQuantity;
    openCost -= entryCost;
    openEntryFees -= allocatedEntryFees;

    if (openQuantity <= 1e-10) {
      openQuantity = 0;
      openCost = 0;
      openEntryFees = 0;
      entryTimestamp = undefined;
    }
  }

  return trades;
}

function calculateClosedTradeMetrics(
  trades: BacktestTrade[]
): Pick<
  BacktestReport["metrics"],
  | "closedTradeCount"
  | "winningTradeCount"
  | "losingTradeCount"
  | "winRatePct"
  | "grossProfit"
  | "grossLoss"
  | "profitFactor"
> {
  const closedPnls = trades.map((trade) => trade.pnl);
  const grossProfit = closedPnls.filter((pnl) => pnl > 0).reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = Math.abs(
    closedPnls.filter((pnl) => pnl < 0).reduce((sum, pnl) => sum + pnl, 0)
  );
  const winningTradeCount = closedPnls.filter((pnl) => pnl > 0).length;
  const losingTradeCount = closedPnls.filter((pnl) => pnl < 0).length;
  const closedTradeCount = closedPnls.length;

  return {
    closedTradeCount,
    winningTradeCount,
    losingTradeCount,
    winRatePct: closedTradeCount === 0 ? 0 : (winningTradeCount / closedTradeCount) * 100,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss
  };
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

function calculateMaxDrawdownPct(equityCurve: BacktestEquityPoint[]): number {
  // Drawdown measures the worst peak-to-trough equity decline observed during the run.
  let peak = equityCurve[0]?.equity ?? 0;
  let maxDrawdown = 0;

  for (const point of equityCurve) {
    const equity = point.equity;
    peak = Math.max(peak, equity);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }
  }

  return maxDrawdown * 100;
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
