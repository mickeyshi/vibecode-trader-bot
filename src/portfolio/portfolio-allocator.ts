import type { MarketEvent } from "../core/types.js";

export interface PortfolioAllocationRequest {
  closeHistoryBySymbol: ReadonlyMap<string, readonly number[]>;
  recentEvents?: readonly MarketEvent[];
}

export interface PortfolioAllocationTarget {
  symbol: string;
  targetWeight: number;
  score: number;
  annualizedVolatility: number;
  reason: string;
}

export interface PortfolioAllocationPlan {
  targets: PortfolioAllocationTarget[];
  grossWeight: number;
  cashWeight: number;
  blockedSymbols: string[];
}

export interface PortfolioAllocator {
  allocate(request: PortfolioAllocationRequest): PortfolioAllocationPlan;
}
