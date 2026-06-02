export type TradingMode = "backtest" | "paper" | "live";

export type Side = "buy" | "sell";

export type OrderType = "market" | "limit";

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d";

export interface Instrument {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: string;
}

export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketTick {
  symbol: string;
  bid?: number;
  ask?: number;
  last: number;
  volume?: number;
  timestamp: Date;
}

export interface MarketEvent {
  id: string;
  source: string;
  eventType: "news" | "filing" | "earnings" | "macro" | "exchange-status";
  symbol?: string;
  headline: string;
  sentiment?: "positive" | "neutral" | "negative";
  importance: number;
  timestamp: Date;
}

export interface Position {
  symbol: string;
  quantity: number;
  averageEntryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  updatedAt: Date;
}

export interface OrderIntent {
  symbol: string;
  side: Side;
  type: OrderType;
  quantity: number;
  limitPrice?: number;
  reason: string;
  strategyId: string;
}

export interface Order {
  id: string;
  intent: OrderIntent;
  status: "new" | "accepted" | "partially-filled" | "filled" | "rejected" | "cancelled";
  createdAt: Date;
  updatedAt: Date;
}

export interface Fill {
  orderId: string;
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  timestamp: Date;
}
