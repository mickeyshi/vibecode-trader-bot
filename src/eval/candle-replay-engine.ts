import type { Candle, MarketTick } from "../core/types.js";
import { InMemoryEventStore, InMemoryMarketDataStore } from "../data/in-memory-stores.js";
import { SimpleFeatureBuilder } from "../data/simple-feature-builder.js";
import type { PaperOrderExecutorConfig } from "../execution/paper-order-executor.js";
import { PaperOrderExecutor } from "../execution/paper-order-executor.js";
import { InMemoryObservabilitySink } from "../observability/in-memory-observability-sink.js";
import type {
  AlertEvent,
  DecisionTrace,
  ObservabilityLog,
  ObservabilityMetric,
  ObservabilitySink
} from "../observability/interfaces.js";
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
  observability?: ObservabilitySink;
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
  observability?: ObservabilitySink;
}

export interface CandleReplayResult {
  candles: Candle[];
  finalSnapshot: AccountSnapshot;
  orders: ReturnType<InMemoryPortfolioStore["getOrders"]>;
  fills: ReturnType<InMemoryPortfolioStore["getFills"]>;
  equityCurve: BacktestEquityPoint[];
  riskRejections: BacktestRiskRejection[];
  dataQualityWarnings: BacktestDataQualityWarning[];
  logs: ObservabilityLog[];
  observabilityMetrics: ObservabilityMetric[];
  decisionTraces: DecisionTrace[];
  alerts: AlertEvent[];
  assumptions: string[];
}

export class CandleReplayEngine {
  constructor(private readonly config: CandleReplayEngineConfig) {}

  async run(request: CandleReplayRequest): Promise<CandleReplayResult> {
    const marketStore = new InMemoryMarketDataStore();
    const eventStore = new InMemoryEventStore();
    const portfolioStore = new InMemoryPortfolioStore(request.startingEquity);
    const strategyId = this.config.strategy.id;
    const collector = new InMemoryObservabilitySink();
    const observabilitySinks = [collector, this.config.observability, request.observability].filter(
      (sink): sink is ObservabilitySink => sink !== undefined
    );
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
    let processedCandles = 0;
    let evaluatedSignals = 0;
    let mappedIntents = 0;
    let submittedOrders = 0;
    let receivedFills = 0;
    let emittedAlerts = 0;
    let nextTraceNumber = 1;
    let nextAlertNumber = 1;
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

    await log({
      timestamp: candles.at(0)?.openTime ?? new Date(0),
      level: "info",
      event: "backtest.replay.started",
      message: `Starting candle replay for ${strategyId}.`,
      context: {
        strategyId,
        candleCount: candles.length,
        symbols: request.symbols
      }
    });

    for (const warning of dataQualityWarnings) {
      await log({
        timestamp: warning.currentTimestamp,
        level: "warn",
        event: "data_quality.missing_gap",
        message: warning.message,
        context: {
          symbol: warning.symbol,
          calendar: warning.calendar,
          gapDays: warning.gapDays,
          missingSessionCount: warning.missingSessionCount
        }
      });
      await alert({
        id: `alert-${nextAlertNumber++}`,
        timestamp: warning.currentTimestamp,
        severity: "warning",
        type: "data-quality-gap",
        message: warning.message,
        context: {
          symbol: warning.symbol,
          calendar: warning.calendar,
          missingSessionCount: warning.missingSessionCount
        }
      });
    }

    for (const candle of candles) {
      processedCandles += 1;
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
      evaluatedSignals += 1;
      const intent = mapper.map(signal, context);
      if (intent) {
        mappedIntents += 1;
      }

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
          const result = await executor.placeOrder(decision.intent);
          submittedOrders += 1;
          receivedFills += result.fills.length;

          if (result.order.status === "cancelled") {
            await alert({
              id: `alert-${nextAlertNumber++}`,
              timestamp: context.now,
              severity: "info",
              type: "paper-order-skipped",
              message: `Paper order ${result.order.id} was skipped by execution assumptions.`,
              context: {
                symbol: decision.intent.symbol,
                strategyId: decision.intent.strategyId,
                side: decision.intent.side
              }
            });
          }

          await decisionTrace({
            id: `trace-${nextTraceNumber++}`,
            timestamp: context.now,
            symbol: candle.symbol,
            strategyId: signal.strategyId,
            signal,
            intent,
            riskDecision: decision,
            order: result.order,
            fillCount: result.fills.length,
            equity: (await portfolioStore.getAccountSnapshot()).equity
          });
        } else {
          riskRejections.push({
            intent,
            reason: decision.reason,
            appliedRules: decision.appliedRules,
            timestamp: context.now
          });
          await log({
            timestamp: context.now,
            level: "warn",
            event: "risk.intent_rejected",
            message: decision.reason,
            context: {
              symbol: intent.symbol,
              strategyId: intent.strategyId,
              appliedRules: decision.appliedRules
            }
          });
          await alert({
            id: `alert-${nextAlertNumber++}`,
            timestamp: context.now,
            severity: "warning",
            type: "risk-rejection",
            message: decision.reason,
            context: {
              symbol: intent.symbol,
              strategyId: intent.strategyId,
              appliedRules: decision.appliedRules
            }
          });
          await decisionTrace({
            id: `trace-${nextTraceNumber++}`,
            timestamp: context.now,
            symbol: candle.symbol,
            strategyId: signal.strategyId,
            signal,
            intent,
            riskDecision: decision,
            fillCount: 0,
            equity: (await portfolioStore.getAccountSnapshot()).equity
          });
        }
      } else {
        await decisionTrace({
          id: `trace-${nextTraceNumber++}`,
          timestamp: context.now,
          symbol: candle.symbol,
          strategyId: signal.strategyId,
          signal,
          fillCount: 0,
          equity: (await portfolioStore.getAccountSnapshot()).equity
        });
      }

      equityCurve.push({
        timestamp: candle.closeTime,
        equity: (await portfolioStore.getAccountSnapshot()).equity
      });
    }

    const finalSnapshot = await portfolioStore.getAccountSnapshot();
    await metric("candles.processed", processedCandles, "count");
    await metric("signals.evaluated", evaluatedSignals, "count");
    await metric("intents.created", mappedIntents, "count");
    await metric("orders.submitted", submittedOrders, "count");
    await metric("fills.received", receivedFills, "count");
    await metric("risk.rejections", riskRejections.length, "count");
    await metric("data_quality.warnings", dataQualityWarnings.length, "count");
    await metric("alerts.emitted", emittedAlerts, "count");
    await metric("account.ending_equity", finalSnapshot.equity, "currency");

    await log({
      timestamp: candles.at(-1)?.closeTime ?? new Date(0),
      level: "info",
      event: "backtest.replay.completed",
      message: `Completed candle replay for ${strategyId}.`,
      context: {
        strategyId,
        processedCandles,
        evaluatedSignals,
        mappedIntents,
        submittedOrders,
        riskRejections: riskRejections.length,
        alerts: emittedAlerts
      }
    });

    const observability = collector.snapshot();

    return {
      candles,
      finalSnapshot,
      orders: portfolioStore.getOrders(),
      fills: portfolioStore.getFills(),
      equityCurve,
      riskRejections,
      dataQualityWarnings,
      logs: observability.logs,
      observabilityMetrics: observability.metrics,
      decisionTraces: observability.decisionTraces,
      alerts: observability.alerts,
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

    async function log(entry: ObservabilityLog): Promise<void> {
      await Promise.all(observabilitySinks.map((sink) => sink.log(entry)));
    }

    async function metric(
      name: string,
      value: number,
      unit: ObservabilityMetric["unit"]
    ): Promise<void> {
      const metricEntry: ObservabilityMetric = {
        timestamp: candles.at(-1)?.closeTime ?? new Date(0),
        name,
        value,
        unit,
        tags: {
          strategyId,
          symbol: request.symbols.length === 1 ? request.symbols[0]! : "multi-symbol"
        }
      };
      await Promise.all(observabilitySinks.map((sink) => sink.metric(metricEntry)));
    }

    async function decisionTrace(trace: DecisionTrace): Promise<void> {
      await Promise.all(observabilitySinks.map((sink) => sink.decisionTrace(trace)));
    }

    async function alert(alertEvent: AlertEvent): Promise<void> {
      emittedAlerts += 1;
      await Promise.all(observabilitySinks.map((sink) => sink.alert(alertEvent)));
    }
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
