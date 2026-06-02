import type { MarketEvent, OrderIntent, Position, TradingMode } from "../core/types.js";

export interface RiskContext {
  mode: TradingMode;
  openPositions: Position[];
  recentEvents: MarketEvent[];
  dailyRealizedPnl: number;
  accountEquity: number;
  cash: number;
  buyingPower: number;
  now: Date;
}

export interface RiskDecision {
  approved: boolean;
  intent?: OrderIntent;
  reason: string;
  appliedRules: string[];
}

export interface RiskEngine {
  evaluate(intent: OrderIntent, context: RiskContext): Promise<RiskDecision>;
}
