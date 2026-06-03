import type { Candle, Fill, Order, OrderIntent } from "../core/types.js";

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

export interface BacktestRequest {
  strategyId: string;
  symbols: string[];
  candles: Candle[];
  startingEquity: number;
  feeRate: number;
  slippageBps: number;
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
  riskRejections: BacktestRiskRejection[];
  equityCurve: BacktestEquityPoint[];
  assumptions: string[];
}

export interface Backtester {
  run(request: BacktestRequest): Promise<BacktestReport>;
}
