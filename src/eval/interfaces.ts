import type { Candle, Fill, Order, OrderIntent } from "../core/types.js";
import type {
  AlertEvent,
  DecisionTrace,
  ObservabilityLog,
  ObservabilityMetric
} from "../observability/interfaces.js";

export type MarketCalendarId = "weekday" | "crypto-24-7";

export interface BacktestRiskRejection {
  intent: OrderIntent;
  reason: string;
  appliedRules: string[];
  timestamp: Date;
}

export interface BacktestEquityPoint {
  timestamp: Date;
  equity: number;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  side: "long";
  entryTimestamp: Date;
  exitTimestamp: Date;
  quantity: number;
  averageEntryPrice: number;
  exitPrice: number;
  entryCost: number;
  exitProceeds: number;
  fees: number;
  pnl: number;
  returnPct: number;
}

export interface BacktestMetrics {
  startingEquity: number;
  endingEquity: number;
  endingCash: number;
  finalPositionValue: number;
  finalGrossExposure: number;
  finalRealizedPnl: number;
  finalUnrealizedPnl: number;
  netProfit: number;
  totalFees: number;
  filledOrderCount: number;
  skippedOrderCount: number;
  closedTradeCount: number;
  winningTradeCount: number;
  losingTradeCount: number;
  winRatePct: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
}

export interface BacktestDataQualityWarning {
  type: "missing-data-gap";
  symbol: string;
  calendar: MarketCalendarId;
  previousTimestamp: Date;
  currentTimestamp: Date;
  gapDays: number;
  missingSessionCount: number;
  message: string;
}

export interface BacktestRequest {
  strategyId: string;
  symbols: string[];
  candles: Candle[];
  startingEquity: number;
  feeRate: number;
  slippageBps: number;
  spreadBps?: number;
  fillRatio?: number;
  skipFillEvery?: number;
  maxDataGapDays?: number;
  marketCalendar?: MarketCalendarId;
  marketHolidays?: string[];
}

export interface BacktestReport {
  strategyId: string;
  start: Date;
  end: Date;
  endingEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  orders: Order[];
  fills: Fill[];
  trades: BacktestTrade[];
  riskRejections: BacktestRiskRejection[];
  equityCurve: BacktestEquityPoint[];
  metrics: BacktestMetrics;
  observabilityMetrics: ObservabilityMetric[];
  decisionTraces: DecisionTrace[];
  logs: ObservabilityLog[];
  alerts: AlertEvent[];
  dataQualityWarnings: BacktestDataQualityWarning[];
  assumptions: string[];
}

export interface Backtester {
  run(request: BacktestRequest): Promise<BacktestReport>;
}
