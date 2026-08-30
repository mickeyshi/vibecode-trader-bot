import type { Candle, MarketEvent, MarketTick, OrderIntent, Position } from "../core/types.js";
import type { RiskDecision, RiskEngine } from "../risk/interfaces.js";
import type { LiveOpsOrderRow } from "../dashboard/live-ops-view-model.js";
import type { SignalToIntentMapper, Strategy, StrategySignal } from "../strategies/interfaces.js";
import type { ExecutionResult, OrderExecutor } from "./interfaces.js";
import type { AccountSnapshot } from "../portfolio/interfaces.js";

export interface LiveTradingCycleRequest {
  symbol: string;
  mode: "paper" | "live";
  strategy: Strategy;
  intentMapper: SignalToIntentMapper;
  riskEngine: RiskEngine;
  executor: OrderExecutor;
  accountSnapshot: AccountSnapshot;
  candles: Candle[];
  positions: Position[];
  events?: MarketEvent[];
  tick?: MarketTick;
  submitOrders?: boolean;
}

export interface LiveTradingCycleResult {
  symbol: string;
  strategyId: string;
  signal: StrategySignal;
  intent?: OrderIntent;
  riskDecision?: RiskDecision;
  executionResult?: ExecutionResult;
  accountSnapshot: AccountSnapshot;
  skippedReason?: string;
}

export async function runLiveTradingCycle(
  request: LiveTradingCycleRequest
): Promise<LiveTradingCycleResult> {
  const context = {
    symbol: request.symbol,
    candles: request.candles,
    events: request.events ?? [],
    positions: request.positions,
    features: {},
    now: request.tick?.timestamp ?? request.candles.at(-1)?.closeTime ?? new Date(),
    ...(request.tick ? { tick: request.tick } : {})
  };
  const signal = await request.strategy.evaluate(context);
  const intent = request.intentMapper.map(signal, context);

  if (!intent) {
    return {
      symbol: request.symbol,
      strategyId: request.strategy.id,
      signal,
      accountSnapshot: request.accountSnapshot,
      skippedReason: "Strategy did not produce an order intent."
    };
  }

  const riskDecision = await request.riskEngine.evaluate(intent, {
    mode: request.mode,
    openPositions: request.positions,
    recentEvents: context.events,
    dailyRealizedPnl: request.accountSnapshot.realizedPnl,
    accountEquity: request.accountSnapshot.equity,
    cash: request.accountSnapshot.cash,
    buyingPower: request.accountSnapshot.buyingPower,
    now: context.now
  });

  if (!riskDecision.approved || !riskDecision.intent) {
    return {
      symbol: request.symbol,
      strategyId: request.strategy.id,
      signal,
      intent,
      riskDecision,
      accountSnapshot: request.accountSnapshot,
      skippedReason: riskDecision.reason
    };
  }

  if (request.submitOrders === false) {
    return {
      symbol: request.symbol,
      strategyId: request.strategy.id,
      signal,
      intent: riskDecision.intent,
      riskDecision,
      accountSnapshot: request.accountSnapshot
    };
  }

  const executionResult = await request.executor.placeOrder(riskDecision.intent);

  return {
    symbol: request.symbol,
    strategyId: request.strategy.id,
    signal,
    intent: riskDecision.intent,
    riskDecision,
    executionResult,
    accountSnapshot: request.accountSnapshot
  };
}

export function liveTradingCycleOrderRows(result: LiveTradingCycleResult): LiveOpsOrderRow[] {
  const order = result.executionResult?.order;
  if (order) {
    const row: LiveOpsOrderRow = {
      id: order.id,
      timestamp: order.updatedAt.toISOString(),
      strategyId: order.intent.strategyId,
      symbol: order.intent.symbol,
      side: order.intent.side,
      quantity: order.intent.quantity,
      status: order.status,
      reason: order.intent.reason
    };

    if (order.intent.limitPrice !== undefined) {
      row.limitPrice = order.intent.limitPrice;
    }

    return [row];
  }

  const intent = result.intent;
  const riskDecision = result.riskDecision;
  if (!intent || !riskDecision || riskDecision.approved) {
    return [];
  }

  const row: LiveOpsOrderRow = {
    id: `risk-${result.signal.createdAt.getTime()}`,
    timestamp: result.signal.createdAt.toISOString(),
    strategyId: intent.strategyId,
    symbol: intent.symbol,
    side: intent.side,
    quantity: intent.quantity,
    status: "rejected",
    reason: riskDecision.reason
  };

  if (intent.limitPrice !== undefined) {
    row.limitPrice = intent.limitPrice;
  }

  return [row];
}
