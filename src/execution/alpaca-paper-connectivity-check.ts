import type { Candle, Order, Position } from "../core/types.js";
import type { AccountSnapshot } from "../portfolio/interfaces.js";

export interface AlpacaPaperConnectivityBroker {
  mode: "paper" | "live";
  getAccountSnapshot(): Promise<AccountSnapshot>;
  getOpenPositions(): Promise<Position[]>;
  getOpenOrders?(): Promise<Order[]>;
}

export interface AlpacaPaperConnectivityMarketData {
  getLatestBars(symbols: string[]): Promise<Candle[]>;
}

export interface AlpacaPaperConnectivityCheckRequest {
  broker: AlpacaPaperConnectivityBroker;
  marketData: AlpacaPaperConnectivityMarketData;
  symbols: string[];
  maxCandleAgeMs?: number;
  now?: Date;
}

export interface AlpacaPaperConnectivityCheckResult {
  provider: "alpaca";
  mode: "paper";
  readOnly: true;
  checkedAt: string;
  status: "pass" | "warning";
  account: {
    equity: number;
    cash: number;
    buyingPower: number;
    grossExposure: number;
    currency: string;
    timestamp: string;
  };
  positions: {
    count: number;
    symbols: string[];
    grossExposure: number;
  };
  openOrders: {
    count: number;
    symbols: string[];
  };
  marketData: {
    symbols: string[];
    candles: Array<{
      symbol: string;
      close: number;
      closeTime: string;
      ageSeconds: number;
      stale: boolean;
    }>;
  };
  warnings: string[];
}

export async function runAlpacaPaperConnectivityCheck(
  request: AlpacaPaperConnectivityCheckRequest
): Promise<AlpacaPaperConnectivityCheckResult> {
  if (request.broker.mode !== "paper") {
    throw new Error("Alpaca paper connectivity check requires paper trading mode.");
  }

  const symbols = uniqueSymbols(request.symbols);
  const now = request.now ?? new Date();
  const maxCandleAgeMs = request.maxCandleAgeMs ?? 15 * 60_000;
  if (maxCandleAgeMs < 0 || !Number.isFinite(maxCandleAgeMs)) {
    throw new Error("Alpaca paper connectivity maxCandleAgeMs must be non-negative and finite.");
  }

  const [accountSnapshot, positions, openOrders, candles] = await Promise.all([
    request.broker.getAccountSnapshot(),
    request.broker.getOpenPositions(),
    request.broker.getOpenOrders ? request.broker.getOpenOrders() : Promise.resolve([]),
    request.marketData.getLatestBars(symbols)
  ]);
  const warnings: string[] = [];
  const candleSummaries = symbols.map((symbol) => {
    const candle = candles.find((candidate) => candidate.symbol === symbol);
    if (!candle) {
      warnings.push(`No latest candle was returned for ${symbol}.`);
      return {
        symbol,
        close: 0,
        closeTime: "",
        ageSeconds: Number.POSITIVE_INFINITY,
        stale: true
      };
    }

    const ageMs = now.getTime() - candle.closeTime.getTime();
    const stale = ageMs > maxCandleAgeMs;
    if (stale) {
      warnings.push(`Latest candle for ${symbol} is stale by ${Math.round(ageMs / 1000)} seconds.`);
    }

    return {
      symbol,
      close: candle.close,
      closeTime: candle.closeTime.toISOString(),
      ageSeconds: Math.max(0, Math.round(ageMs / 1000)),
      stale
    };
  });

  if (openOrders.length > 0) {
    warnings.push(`${openOrders.length} open paper order(s) already exist.`);
  }

  return {
    provider: "alpaca",
    mode: "paper",
    readOnly: true,
    checkedAt: now.toISOString(),
    status: warnings.length === 0 ? "pass" : "warning",
    account: {
      equity: accountSnapshot.equity,
      cash: accountSnapshot.cash,
      buyingPower: accountSnapshot.buyingPower,
      grossExposure: accountSnapshot.grossExposure,
      currency: accountSnapshot.currency,
      timestamp: accountSnapshot.timestamp.toISOString()
    },
    positions: {
      count: positions.length,
      symbols: positions.map((position) => position.symbol).sort(),
      grossExposure: positions.reduce(
        (sum, position) => sum + Math.abs(position.quantity * position.markPrice),
        0
      )
    },
    openOrders: {
      count: openOrders.length,
      symbols: [...new Set(openOrders.map((order) => order.intent.symbol))].sort()
    },
    marketData: {
      symbols,
      candles: candleSummaries
    },
    warnings
  };
}

function uniqueSymbols(symbols: string[]): string[] {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (unique.length === 0) {
    throw new Error("At least one symbol is required for the Alpaca paper connectivity check.");
  }

  return unique;
}
