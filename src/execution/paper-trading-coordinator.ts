import type { Candle, Order, OrderIntent, Position } from "../core/types.js";
import {
  buildLiveOpsSnapshot,
  type LiveOpsSnapshotConfig
} from "../dashboard/live-ops-snapshot.js";
import type {
  LiveOpsDashboardViewModel,
  LiveOpsPaperCycleRow
} from "../dashboard/live-ops-view-model.js";
import type { AccountSnapshot } from "../portfolio/interfaces.js";
import type { RiskContext, RiskDecision, RiskEngine } from "../risk/interfaces.js";
import type { SignalToIntentMapper, Strategy, StrategySignal } from "../strategies/interfaces.js";
import type { ExecutionResult, OrderExecutor } from "./interfaces.js";
import {
  liveTradingCycleOrderRows,
  runLiveTradingCycle,
  type LiveTradingCycleResult
} from "./live-trading-cycle.js";
import {
  marketSessionStatus,
  type MarketCalendarDay,
  type MarketSessionConfig
} from "./market-session.js";
import {
  buildPaperTradingCoordinatorState,
  isPendingOrderStatus,
  type PaperTradingStateCandle,
  type PaperTradingStateLastExecutedCandle,
  type PaperTradingStateOrder,
  type PaperTradingStateStore,
  type SubmissionJournal
} from "./paper-trading-state.js";
import type { TradingGatewayConfig } from "./trading-gateway.js";
import { TradingGateway } from "./trading-gateway.js";

export interface PaperTradingBroker extends OrderExecutor {
  getAccountSnapshot(): Promise<AccountSnapshot>;
  getOpenPositions(): Promise<Position[]>;
  getOpenOrders?(): Promise<Order[]>;
  getMarketCalendar?(startDate: string, endDate?: string): Promise<MarketCalendarDay[]>;
  getOrderByClientOrderId?(clientOrderId: string): Promise<Order | undefined>;
}

export interface PaperTradingMarketData {
  getLatestBars(symbols: string[]): Promise<Candle[]>;
  getHistoricalBars?(symbols: string[], request: { limit: number; end?: Date }): Promise<Candle[]>;
}

export interface PaperTradingCoordinatorRequest {
  symbols: string[];
  iterations: number;
  intervalMs: number;
  strategy: Strategy;
  intentMapper: SignalToIntentMapper;
  riskEngineFactory(accountSnapshot: AccountSnapshot): RiskEngine;
  broker: PaperTradingBroker;
  marketData: PaperTradingMarketData;
  snapshotConfig: LiveOpsSnapshotConfig;
  priorBreakEvenAuditMet?: boolean;
  priorBreakEvenAuditDayCount?: number;
  maxCandleAgeMs?: number;
  maxHistoryCandles?: number;
  maxExecutionsPerRun?: number;
  maxNotionalPerRun?: number;
  dryRun?: boolean;
  marketSession?: MarketSessionConfig;
  now?: Date;
  sleep?: (milliseconds: number) => Promise<void>;
  stateStore?: PaperTradingStateStore;
  submissionJournal?: SubmissionJournal;
  orderExecutor?: OrderExecutor;
  heartbeat?: (iteration: number, timestamp: Date) => Promise<void>;
}

export interface PaperTradingCoordinatorResult {
  cycles: LiveTradingCycleResult[];
  executions: ExecutionResult[];
  liveOps: LiveOpsDashboardViewModel;
  runSummary: {
    dryRun: boolean;
    submittedNotional: number;
    maxNotionalPerRun: number | null;
    executionCount: number;
    maxExecutionsPerRun: number | null;
    skippedCount: number;
  };
}

export async function runPaperTradingCoordinator(
  request: PaperTradingCoordinatorRequest
): Promise<PaperTradingCoordinatorResult> {
  if (request.broker.mode !== "paper" || request.snapshotConfig.mode !== "paper") {
    throw new Error("Paper trading coordinator only runs when Alpaca trading mode is paper.");
  }

  if (request.iterations <= 0 || !Number.isInteger(request.iterations)) {
    throw new Error("Paper trading coordinator iterations must be a positive integer.");
  }

  if (request.intervalMs < 0 || !Number.isFinite(request.intervalMs)) {
    throw new Error("Paper trading coordinator intervalMs must be a non-negative finite number.");
  }

  const symbols = uniqueSymbols(request.symbols);
  const maxCandleAgeMs = request.maxCandleAgeMs ?? 15 * 60_000;
  if (maxCandleAgeMs < 0 || !Number.isFinite(maxCandleAgeMs)) {
    throw new Error(
      "Paper trading coordinator maxCandleAgeMs must be a non-negative finite number."
    );
  }
  const maxHistoryCandles = request.maxHistoryCandles ?? 100;
  if (maxHistoryCandles <= 0 || !Number.isInteger(maxHistoryCandles)) {
    throw new Error("Paper trading coordinator maxHistoryCandles must be a positive integer.");
  }
  const maxExecutionsPerRun = request.maxExecutionsPerRun ?? Number.POSITIVE_INFINITY;
  if (
    maxExecutionsPerRun < 0 ||
    (!Number.isInteger(maxExecutionsPerRun) && Number.isFinite(maxExecutionsPerRun))
  ) {
    throw new Error(
      "Paper trading coordinator maxExecutionsPerRun must be a non-negative integer."
    );
  }
  const maxNotionalPerRun = request.maxNotionalPerRun ?? Number.POSITIVE_INFINITY;
  if (maxNotionalPerRun < 0 || Number.isNaN(maxNotionalPerRun)) {
    throw new Error("Paper trading coordinator maxNotionalPerRun must be non-negative.");
  }

  const cycles: LiveTradingCycleResult[] = [];
  const executions: ExecutionResult[] = [];
  const candleHistory = new Map<string, Candle[]>();
  let submittedNotional = 0;
  const startedAt = request.now ?? new Date();
  const previousState = await request.stateStore?.load();
  const journalBlocks = await reconcileSubmissionJournal(
    request.submissionJournal,
    request.broker,
    startedAt
  );
  const reconciliation = await reconcilePersistedPendingOrders(
    previousState?.pendingOrders ?? [],
    request.broker,
    startedAt
  );
  const reconciledPendingOrders = reconciliation.pendingOrders;
  appendCandles(
    candleHistory,
    stateCandlesToCandles(previousState?.candleHistory ?? []),
    maxHistoryCandles
  );
  if (request.marketData.getHistoricalBars) {
    appendCandles(
      candleHistory,
      await request.marketData.getHistoricalBars(symbols, {
        limit: maxHistoryCandles,
        end: startedAt
      }),
      maxHistoryCandles
    );
  }
  const lastExecutedCandles = lastExecutedCandlesBySymbol(previousState?.lastExecutedCandles ?? []);
  const calendarDays = new Map<string, MarketCalendarDay | null>();

  for (let iteration = 0; iteration < request.iterations; iteration += 1) {
    const now = request.now ?? new Date();
    await request.heartbeat?.(iteration, now);
    let sessionStatus = request.marketSession
      ? marketSessionStatus(now, request.marketSession)
      : undefined;
    if (sessionStatus && request.broker.getMarketCalendar) {
      let calendarDay = calendarDays.get(sessionStatus.localDate);
      if (calendarDay === undefined) {
        const days = await request.broker.getMarketCalendar(sessionStatus.localDate);
        calendarDay = days.find((day) => day.date === sessionStatus!.localDate) ?? null;
        calendarDays.set(sessionStatus.localDate, calendarDay);
      }
      sessionStatus = marketSessionStatus(now, {
        ...request.marketSession!,
        ...(calendarDay
          ? { openTime: calendarDay.openTime, closeTime: calendarDay.closeTime }
          : { holidays: [...request.marketSession!.holidays, sessionStatus.localDate] })
      });
    }
    if (sessionStatus && !sessionStatus.isOpen) {
      const accountSnapshot = await request.broker.getAccountSnapshot();
      const reason = `Market session is closed: ${sessionStatus.reason}`;
      for (const symbol of symbols) {
        cycles.push(
          skippedCycle({
            symbol,
            strategyId: request.strategy.id,
            accountSnapshot,
            reason,
            now
          })
        );
      }

      if (iteration < request.iterations - 1 && request.intervalMs > 0) {
        await (request.sleep ?? sleep)(request.intervalMs);
      }

      continue;
    }

    const candles = await request.marketData.getLatestBars(symbols);
    appendCandles(candleHistory, candles, maxHistoryCandles);
    const openOrders = request.broker.getOpenOrders ? await request.broker.getOpenOrders() : [];

    for (const symbol of symbols) {
      const accountSnapshot = await request.broker.getAccountSnapshot();
      const positions = await request.broker.getOpenPositions();
      const symbolCandles = candleHistory.get(symbol) ?? [];
      const latestCandle = symbolCandles.at(-1);
      const pendingOrder = openOrders.find(
        (order) => order.intent.symbol === symbol && isPendingOrderStatus(order.status)
      );
      const persistedPendingOrder = reconciledPendingOrders.find(
        (order) => order.symbol === symbol && isPendingOrderStatus(order.status)
      );
      const terminalReconciliation = reconciliation.terminalOrders.find(
        (order) => order.symbol === symbol
      );
      const staleReason = staleCandleReason(symbol, symbolCandles, maxCandleAgeMs, now);

      const journalBlock = journalBlocks.get(symbol);
      if (
        pendingOrder ||
        persistedPendingOrder ||
        terminalReconciliation ||
        journalBlock ||
        staleReason
      ) {
        cycles.push(
          skippedCycle({
            symbol,
            strategyId: request.strategy.id,
            accountSnapshot,
            reason: pendingOrder
              ? `Open ${pendingOrder.status} order ${pendingOrder.id} already exists for ${symbol}.`
              : persistedPendingOrder
                ? persistedPendingOrderReason(persistedPendingOrder)
                : terminalReconciliation
                  ? `Persisted order ${terminalReconciliation.id} is ${terminalReconciliation.status}; waiting until the next run for broker positions to converge for ${symbol}.`
                  : journalBlock
                    ? journalBlock
                    : staleReason!,
            now
          })
        );
        continue;
      }

      if (executions.length >= maxExecutionsPerRun) {
        cycles.push(
          skippedCycle({
            symbol,
            strategyId: request.strategy.id,
            accountSnapshot,
            reason: `Paper execution cap reached: ${executions.length} execution(s) already submitted this run.`,
            now
          })
        );
        continue;
      }

      const gatewayConfig: TradingGatewayConfig = {
        requestedMode: "paper",
        liveTradingEnabled: request.snapshotConfig.liveTradingEnabled,
        operatorConfirmedLive: request.snapshotConfig.operatorConfirmedLive,
        killSwitchArmed: request.snapshotConfig.killSwitchArmed,
        maxDailyLossBreached: accountSnapshot.realizedPnl <= -request.snapshotConfig.maxDailyLoss,
        brokerCredentialsConfigured: request.snapshotConfig.brokerCredentialsConfigured,
        stopAfterBreakEven: request.snapshotConfig.stopAfterBreakEven,
        breakEvenTargetMet:
          accountSnapshot.equity >=
          request.snapshotConfig.dayStartingEquity + request.snapshotConfig.dayFeesPaid,
        requirePriorBreakEvenAudit: request.snapshotConfig.requirePriorBreakEvenAudit,
        allowBreakEvenExitOrders: true,
        openPositions: positions
      };

      if (request.priorBreakEvenAuditMet !== undefined) {
        gatewayConfig.priorBreakEvenAuditMet = request.priorBreakEvenAuditMet;
      }

      if (request.priorBreakEvenAuditDayCount !== undefined) {
        gatewayConfig.priorBreakEvenAuditDayCount = request.priorBreakEvenAuditDayCount;
      }

      const gateway = new TradingGateway(request.orderExecutor ?? request.broker, gatewayConfig);
      const cycle = await runLiveTradingCycle({
        symbol,
        mode: "paper",
        strategy: request.strategy,
        intentMapper: request.intentMapper,
        riskEngine: new FreshCandleRiskEngine(
          new RunNotionalRiskEngine(
            request.riskEngineFactory(accountSnapshot),
            () => submittedNotional,
            maxNotionalPerRun
          ),
          () => lastExecutedCandles.get(symbol),
          latestCandle
        ),
        executor: gateway,
        accountSnapshot,
        candles: symbolCandles,
        positions,
        submitOrders: !request.dryRun
      });

      cycles.push(cycle);
      if (cycle.executionResult) {
        executions.push(cycle.executionResult);
        submittedNotional += orderIntentNotional(cycle.executionResult.order.intent) ?? 0;
        if (latestCandle) {
          lastExecutedCandles.set(symbol, {
            symbol,
            closeTime: latestCandle.closeTime.toISOString(),
            orderId: cycle.executionResult.order.id,
            side: cycle.executionResult.order.intent.side,
            strategyId: cycle.executionResult.order.intent.strategyId,
            updatedAt: cycle.executionResult.order.updatedAt.toISOString()
          });
        }
      }
    }

    if (iteration < request.iterations - 1 && request.intervalMs > 0) {
      await (request.sleep ?? sleep)(request.intervalMs);
    }
  }

  const accountSnapshot = await request.broker.getAccountSnapshot();
  const positions = await request.broker.getOpenPositions();
  const runSummary = {
    dryRun: request.dryRun ?? false,
    submittedNotional,
    maxNotionalPerRun: Number.isFinite(maxNotionalPerRun) ? maxNotionalPerRun : null,
    executionCount: executions.length,
    maxExecutionsPerRun: Number.isFinite(maxExecutionsPerRun) ? maxExecutionsPerRun : null,
    skippedCount: cycles.filter((cycle) => cycle.skippedReason).length
  };
  const liveOps = buildLiveOpsSnapshot(
    accountSnapshot,
    request.snapshotConfig,
    positions.map((position) => ({
      symbol: position.symbol,
      quantity: position.quantity,
      averageEntryPrice: position.averageEntryPrice,
      markPrice: position.markPrice,
      unrealizedPnl: position.unrealizedPnl,
      exposure: Math.abs(position.quantity * position.markPrice)
    })),
    cycles.flatMap(liveTradingCycleOrderRows),
    runSummary,
    paperCycleRows(cycles)
  );
  const completedAt = request.now ?? new Date();
  const stateInput = {
    ...(previousState ? { previous: previousState } : {}),
    startedAt,
    completedAt,
    symbols,
    cycleCount: cycles.length,
    executionCount: executions.length,
    skippedCount: cycles.filter((cycle) => cycle.skippedReason).length,
    orders: executions.map((execution) => execution.order),
    persistedPendingOrders: reconciledPendingOrders,
    candleHistory: candleHistoryForState(candleHistory),
    lastExecutedCandles: [...lastExecutedCandles.values()].sort((left, right) =>
      left.symbol.localeCompare(right.symbol)
    )
  };
  await request.stateStore?.save(buildPaperTradingCoordinatorState(stateInput));

  return {
    cycles,
    executions,
    liveOps,
    runSummary
  };
}

class RunNotionalRiskEngine implements RiskEngine {
  constructor(
    private readonly inner: RiskEngine,
    private readonly submittedNotional: () => number,
    private readonly maxNotionalPerRun: number
  ) {}

  async evaluate(intent: OrderIntent, context: RiskContext): Promise<RiskDecision> {
    const decision = await this.inner.evaluate(intent, context);
    if (!decision.approved || !decision.intent) {
      return decision;
    }

    const notional = orderIntentNotional(decision.intent);
    if (notional === undefined) {
      return {
        approved: false,
        reason: "Order intent must include a positive limitPrice for run-level notional checks.",
        appliedRules: [...decision.appliedRules, "max-run-notional"]
      };
    }

    const projectedNotional = this.submittedNotional() + notional;
    if (projectedNotional > this.maxNotionalPerRun) {
      return {
        approved: false,
        reason: `Projected paper run notional ${projectedNotional.toFixed(2)} exceeds max run notional ${this.maxNotionalPerRun.toFixed(2)}.`,
        appliedRules: [...decision.appliedRules, "max-run-notional"]
      };
    }

    return {
      ...decision,
      appliedRules: [...decision.appliedRules, "max-run-notional"]
    };
  }
}

class FreshCandleRiskEngine implements RiskEngine {
  constructor(
    private readonly inner: RiskEngine,
    private readonly lastExecutedCandle: () => PaperTradingStateLastExecutedCandle | undefined,
    private readonly latestCandle: Candle | undefined
  ) {}

  async evaluate(intent: OrderIntent, context: RiskContext): Promise<RiskDecision> {
    const lastExecutedCandle = this.lastExecutedCandle();
    if (lastExecutedCandle && this.latestCandle) {
      const lastCloseTime = new Date(lastExecutedCandle.closeTime).getTime();
      const latestCloseTime = this.latestCandle.closeTime.getTime();
      if (lastCloseTime >= latestCloseTime) {
        return {
          approved: false,
          reason: `Last paper execution for ${intent.symbol} already used latest candle ${this.latestCandle.closeTime.toISOString()}; waiting for a fresh candle.`,
          appliedRules: ["fresh-candle-execution"]
        };
      }
    }

    const decision = await this.inner.evaluate(intent, context);
    return {
      ...decision,
      appliedRules: [...decision.appliedRules, "fresh-candle-execution"]
    };
  }
}

function orderIntentNotional(intent: OrderIntent): number | undefined {
  if (!intent.limitPrice || intent.limitPrice <= 0) {
    return undefined;
  }

  return Math.abs(intent.quantity * intent.limitPrice);
}

function lastExecutedCandlesBySymbol(
  candles: PaperTradingStateLastExecutedCandle[]
): Map<string, PaperTradingStateLastExecutedCandle> {
  return new Map(candles.map((candle) => [candle.symbol.toUpperCase(), candle]));
}

function uniqueSymbols(symbols: string[]): string[] {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (unique.length === 0) {
    throw new Error("At least one symbol is required for the paper trading coordinator.");
  }

  return unique;
}

function staleCandleReason(
  symbol: string,
  candles: Candle[],
  maxCandleAgeMs: number,
  now: Date
): string | undefined {
  const latestCandle = candles.at(-1);
  if (!latestCandle) {
    return `No latest candle is available for ${symbol}.`;
  }

  const ageMs = now.getTime() - latestCandle.closeTime.getTime();
  if (ageMs > maxCandleAgeMs) {
    return `Latest candle for ${symbol} is stale by ${Math.round(ageMs / 1000)} seconds.`;
  }

  return undefined;
}

function appendCandles(
  candleHistory: Map<string, Candle[]>,
  candles: Candle[],
  maxHistoryCandles: number
): void {
  for (const candle of candles) {
    const symbol = candle.symbol.toUpperCase();
    const previous = candleHistory.get(symbol) ?? [];
    const nextByCloseTime = new Map(
      previous.map((historyCandle) => [historyCandle.closeTime.getTime(), historyCandle])
    );
    nextByCloseTime.set(candle.closeTime.getTime(), {
      ...candle,
      symbol
    });
    const next = [...nextByCloseTime.values()]
      .sort((left, right) => left.closeTime.getTime() - right.closeTime.getTime())
      .slice(-maxHistoryCandles);

    candleHistory.set(symbol, next);
  }
}

function stateCandlesToCandles(candles: PaperTradingStateCandle[]): Candle[] {
  return candles.map((candle) => ({
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    openTime: new Date(candle.openTime),
    closeTime: new Date(candle.closeTime),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  }));
}

function candleHistoryForState(candleHistory: Map<string, Candle[]>): Candle[] {
  return [...candleHistory.values()]
    .flat()
    .sort((left, right) =>
      left.symbol === right.symbol
        ? left.closeTime.getTime() - right.closeTime.getTime()
        : left.symbol.localeCompare(right.symbol)
    );
}

function skippedCycle({
  symbol,
  strategyId,
  accountSnapshot,
  reason,
  now
}: {
  symbol: string;
  strategyId: string;
  accountSnapshot: AccountSnapshot;
  reason: string;
  now: Date;
}): LiveTradingCycleResult {
  const signal: StrategySignal = {
    strategyId,
    symbol,
    action: "hold",
    confidence: 0,
    reason,
    createdAt: now
  };

  return {
    symbol,
    strategyId,
    signal,
    accountSnapshot,
    skippedReason: reason
  };
}

function paperCycleRows(cycles: LiveTradingCycleResult[]): LiveOpsPaperCycleRow[] {
  return cycles.map((cycle, index) => {
    const row: LiveOpsPaperCycleRow = {
      id: `paper-cycle-${index + 1}-${cycle.symbol}-${cycle.signal.createdAt.getTime()}`,
      timestamp: cycle.signal.createdAt.toISOString(),
      strategyId: cycle.strategyId,
      symbol: cycle.symbol,
      action: cycle.signal.action,
      confidence: cycle.signal.confidence,
      reason: cycle.signal.reason,
      status: paperCycleStatus(cycle)
    };

    if (cycle.skippedReason !== undefined) {
      row.skippedReason = cycle.skippedReason;
    }

    if (cycle.riskDecision !== undefined) {
      row.riskApproved = cycle.riskDecision.approved;
    }

    if (cycle.executionResult !== undefined) {
      row.orderStatus = cycle.executionResult.order.status;
    }

    return row;
  });
}

function paperCycleStatus(cycle: LiveTradingCycleResult): LiveOpsPaperCycleRow["status"] {
  if (cycle.executionResult) return "submitted";
  if (cycle.riskDecision?.approved) return "approved";
  if (cycle.riskDecision && !cycle.riskDecision.approved) return "rejected";
  if (cycle.skippedReason) return cycle.intent ? "rejected" : "skipped";
  return "held";
}

async function reconcileSubmissionJournal(
  journal: SubmissionJournal | undefined,
  broker: PaperTradingBroker,
  now: Date
): Promise<Map<string, string>> {
  const blocks = new Map<string, string>();
  if (!journal) return blocks;
  const unresolved = await journal.unresolved();
  if (unresolved.length > 0 && !broker.getOrderByClientOrderId) {
    throw new Error("Unresolved submission journal entries require broker client-order lookup.");
  }

  for (const entry of unresolved) {
    try {
      const order = await broker.getOrderByClientOrderId!(entry.idempotencyKey);
      if (!order) {
        await journal.markNotFound(
          entry.idempotencyKey,
          "Broker reported no order for the durable idempotency key.",
          now
        );
        blocks.set(
          entry.intent.symbol,
          `Journaled submission ${entry.idempotencyKey} was not found at the broker; ${entry.intent.symbol} is quarantined for this run.`
        );
        continue;
      }
      await journal.confirm(entry.idempotencyKey, order, now);
      blocks.set(
        entry.intent.symbol,
        `Journaled submission ${entry.idempotencyKey} reconciled to broker order ${order.id}; ${entry.intent.symbol} is quarantined for this run.`
      );
    } catch (error) {
      blocks.set(
        entry.intent.symbol,
        `Journaled submission ${entry.idempotencyKey} could not be reconciled; exposure remains blocked for ${entry.intent.symbol}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return blocks;
}

async function reconcilePersistedPendingOrders(
  orders: PaperTradingStateOrder[],
  broker: PaperTradingBroker,
  reconciledAt: Date
): Promise<PendingOrderReconciliation> {
  const pendingOrders: PaperTradingStateOrder[] = [];
  const terminalOrders: TerminalReconciledOrder[] = [];

  for (const order of orders) {
    let brokerOrder: Order | undefined;
    try {
      brokerOrder = await broker.getOrder(order.id);
    } catch {
      pendingOrders.push({
        ...order,
        reconciliationStatus: "lookup-failed",
        reconciledAt: reconciledAt.toISOString(),
        reconciliationDetail: "Broker order lookup failed; exposure remains blocked."
      });
      continue;
    }

    if (!brokerOrder) {
      pendingOrders.push({
        ...order,
        reconciliationStatus: "not-found",
        reconciledAt: reconciledAt.toISOString(),
        reconciliationDetail: "Broker order was not found; exposure remains blocked."
      });
      continue;
    }

    if (isPendingOrderStatus(brokerOrder.status)) {
      pendingOrders.push({
        id: brokerOrder.id,
        symbol: brokerOrder.intent.symbol,
        side: brokerOrder.intent.side,
        quantity: brokerOrder.intent.quantity,
        status: brokerOrder.status,
        strategyId: brokerOrder.intent.strategyId,
        updatedAt: brokerOrder.updatedAt.toISOString(),
        reconciliationStatus: "confirmed-pending",
        reconciledAt: reconciledAt.toISOString(),
        reconciliationDetail: "Broker confirms that the order is still pending.",
        ...(brokerOrder.filledQuantity !== undefined
          ? { filledQuantity: brokerOrder.filledQuantity }
          : {}),
        ...(brokerOrder.averageFillPrice !== undefined
          ? { averageFillPrice: brokerOrder.averageFillPrice }
          : {})
      });
      continue;
    }

    terminalOrders.push({
      id: brokerOrder.id,
      symbol: brokerOrder.intent.symbol,
      status: brokerOrder.status
    });
  }

  return { pendingOrders, terminalOrders };
}

interface TerminalReconciledOrder {
  id: string;
  symbol: string;
  status: Extract<Order["status"], "filled" | "rejected" | "cancelled">;
}

interface PendingOrderReconciliation {
  pendingOrders: PaperTradingStateOrder[];
  terminalOrders: TerminalReconciledOrder[];
}

function persistedPendingOrderReason(order: PaperTradingStateOrder): string {
  if (order.reconciliationStatus === "lookup-failed") {
    return `Broker lookup failed for persisted order ${order.id}; exposure remains blocked for ${order.symbol}.`;
  }

  if (order.reconciliationStatus === "not-found") {
    return `Persisted order ${order.id} was not found at the broker; exposure remains blocked for ${order.symbol}.`;
  }

  return `Persisted ${order.status} order ${order.id} requires reconciliation for ${order.symbol}.`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
