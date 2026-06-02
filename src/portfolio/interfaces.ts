import type { Fill, Order, Position } from "../core/types.js";

export interface AccountSnapshot {
  equity: number;
  cash: number;
  buyingPower: number;
  realizedPnl: number;
  currency: string;
  timestamp: Date;
}

export interface PortfolioStore {
  saveOrder(order: Order): Promise<void>;
  saveFill(fill: Fill): Promise<void>;
  getOpenPositions(): Promise<Position[]>;
  getAccountSnapshot(): Promise<AccountSnapshot>;
}
