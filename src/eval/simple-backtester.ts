import type { Fill } from "../core/types.js";
import type { RiskEngine } from "../risk/interfaces.js";
import type { SignalToIntentMapper, Strategy } from "../strategies/interfaces.js";
import { CandleReplayEngine } from "./candle-replay-engine.js";
import type {
  BacktestEquityPoint,
  BacktestReport,
  BacktestRequest,
  Backtester,
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
    const replay = await new CandleReplayEngine(this.config).run({
      symbols: request.symbols,
      candles: request.candles,
      startingEquity: request.startingEquity,
      execution: {
        feeRate: request.feeRate,
        slippageBps: request.slippageBps,
        spreadBps: request.spreadBps ?? 0,
        fillRatio: request.fillRatio ?? 1,
        ...(request.skipFillEvery !== undefined ? { skipFillEvery: request.skipFillEvery } : {})
      },
      riskDefaults: {
        maxOrderNotional: request.startingEquity * 0.2,
        maxPositionNotional: request.startingEquity * 0.5,
        maxDailyLossPct: 0.05,
        blockHighImpactEventsAtOrAbove: 10,
        maxGrossLeverage: 1,
        estimatedFeeRate: request.feeRate,
        estimatedSlippageBps: request.slippageBps,
        estimatedSpreadBps: request.spreadBps ?? 0
      },
      notionalPerTrade: request.startingEquity * 0.1,
      maxDataGapDays: request.maxDataGapDays ?? 4,
      ...(request.marketCalendar !== undefined ? { marketCalendar: request.marketCalendar } : {}),
      ...(request.marketHolidays !== undefined ? { marketHolidays: request.marketHolidays } : {})
    });
    const finalSnapshot = replay.finalSnapshot;
    const firstCandle = replay.candles.at(0);
    const lastCandle = replay.candles.at(-1);
    const orders = replay.orders;
    const fills = replay.fills;
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
      maxDrawdownPct: calculateMaxDrawdownPct(replay.equityCurve),
      orders,
      fills,
      trades,
      riskRejections: replay.riskRejections,
      equityCurve: replay.equityCurve,
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
      dataQualityWarnings: replay.dataQualityWarnings,
      assumptions: replay.assumptions
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
