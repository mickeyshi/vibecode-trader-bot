import type { Fill, Order, OrderIntent, Position } from "../core/types.js";
import { requestWithAlpacaRetry, type AlpacaRetryConfig } from "../feeds/alpaca-retry.js";
import type { AccountSnapshot } from "../portfolio/interfaces.js";
import type { AlpacaTradingConfig } from "./alpaca-trading-config.js";
import type { ExecutionResult, OrderExecutor } from "./interfaces.js";
import type { MarketCalendarDay } from "./market-session.js";
import { sanitizedExternalErrorDetail } from "../observability/external-error-sanitizer.js";

export type AlpacaTradingFetch = (
  input: string,
  init: {
    method: "GET" | "POST" | "DELETE";
    headers: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

interface AlpacaAccountResponse {
  equity: string;
  cash: string;
  buying_power: string;
  currency: string;
  last_equity?: string;
  long_market_value?: string;
  short_market_value?: string;
}

interface AlpacaOrderResponse {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | string;
  qty?: string;
  limit_price?: string | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
  filled_qty?: string;
  filled_avg_price?: string | null;
  client_order_id?: string;
}

interface AlpacaPositionResponse {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  unrealized_pl: string;
}

interface AlpacaCalendarResponse {
  date: string;
  open: string;
  close: string;
}

export class AlpacaOrderExecutor implements OrderExecutor {
  readonly mode: AlpacaTradingConfig["mode"];
  private readonly fetchImpl: AlpacaTradingFetch;
  private clientOrderSequence = 0;

  constructor(
    private readonly config: AlpacaTradingConfig,
    fetchImpl: AlpacaTradingFetch = fetch,
    private readonly retryConfig: AlpacaRetryConfig = {}
  ) {
    this.mode = config.mode;
    this.fetchImpl = fetchImpl;
  }

  async getAccountSnapshot(): Promise<AccountSnapshot> {
    const account = await this.request<AlpacaAccountResponse>("/v2/account", {
      method: "GET"
    });
    const longMarketValue = optionalNumber(account.long_market_value) ?? 0;
    const shortMarketValue = optionalNumber(account.short_market_value) ?? 0;

    return {
      equity: numberValue(account.equity, "Alpaca account.equity"),
      cash: numberValue(account.cash, "Alpaca account.cash"),
      buyingPower: numberValue(account.buying_power, "Alpaca account.buying_power"),
      realizedPnl: 0,
      unrealizedPnl: 0,
      positionValue: longMarketValue + shortMarketValue,
      grossExposure: Math.abs(longMarketValue) + Math.abs(shortMarketValue),
      currency: stringValue(account.currency, "Alpaca account.currency"),
      timestamp: new Date()
    };
  }

  async getOpenPositions(): Promise<Position[]> {
    const positions = await this.request<AlpacaPositionResponse[]>("/v2/positions", {
      method: "GET"
    });

    return positions.map((position) => ({
      symbol: stringValue(position.symbol, "Alpaca position.symbol"),
      quantity: numberValue(position.qty, "Alpaca position.qty"),
      averageEntryPrice: numberValue(position.avg_entry_price, "Alpaca position.avg_entry_price"),
      markPrice: numberValue(position.current_price, "Alpaca position.current_price"),
      unrealizedPnl: numberValue(position.unrealized_pl, "Alpaca position.unrealized_pl"),
      updatedAt: new Date()
    }));
  }

  async getOpenOrders(): Promise<Order[]> {
    const orders = await this.request<AlpacaOrderResponse[]>("/v2/orders?status=open", {
      method: "GET"
    });

    return orders.map((order) => toOrder(order));
  }

  async getMarketCalendar(startDate: string, endDate = startDate): Promise<MarketCalendarDay[]> {
    const params = new URLSearchParams({ start: startDate, end: endDate });
    const days = await this.request<AlpacaCalendarResponse[]>(`/v2/calendar?${params.toString()}`, {
      method: "GET"
    });
    return days.map((day) => ({
      date: isoDateValue(day.date, "Alpaca calendar.date"),
      openTime: sessionTimeValue(day.open, "Alpaca calendar.open"),
      closeTime: sessionTimeValue(day.close, "Alpaca calendar.close")
    }));
  }

  async placeOrder(intent: OrderIntent): Promise<ExecutionResult> {
    const clientOrderId =
      intent.idempotencyKey ?? buildClientOrderId(intent, this.nextClientOrderSequence());
    const alpacaOrder = await this.request<AlpacaOrderResponse>("/v2/orders", {
      method: "POST",
      body: JSON.stringify(toAlpacaOrderRequest(intent, clientOrderId))
    });

    return {
      order: toOrder(alpacaOrder, intent),
      fills: toSyntheticFill(alpacaOrder, intent),
      rawResponse: alpacaOrder
    };
  }

  async cancelOrder(orderId: string): Promise<Order> {
    await this.request<unknown>(`/v2/orders/${encodeURIComponent(orderId)}`, {
      method: "DELETE"
    });

    const now = new Date();
    return {
      id: orderId,
      intent: {
        symbol: "UNKNOWN",
        side: "sell",
        type: "market",
        quantity: 0,
        reason: "Alpaca cancel request.",
        strategyId: "unknown"
      },
      status: "cancelled",
      createdAt: now,
      updatedAt: now
    };
  }

  async getOrder(orderId: string): Promise<Order | undefined> {
    const alpacaOrder = await this.request<AlpacaOrderResponse>(
      `/v2/orders/${encodeURIComponent(orderId)}`,
      { method: "GET" }
    );

    return toOrder(alpacaOrder);
  }

  async getOrderByClientOrderId(clientOrderId: string): Promise<Order | undefined> {
    const path = `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`;
    const { response, body } = await this.rawRequest(path, { method: "GET" });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(
        `Alpaca trading request failed with ${response.status} ${response.statusText}: ${sanitizedExternalErrorDetail(body)}`
      );
    }
    return toOrder(JSON.parse(body) as AlpacaOrderResponse);
  }

  private async request<T>(
    path: string,
    init: { method: "GET" | "POST" | "DELETE"; body?: string }
  ): Promise<T> {
    const { response, body } = await this.rawRequest(path, init);

    if (!response.ok) {
      throw new Error(
        `Alpaca trading request failed with ${response.status} ${response.statusText}: ${sanitizedExternalErrorDetail(body)}`
      );
    }

    return body ? (JSON.parse(body) as T) : ({} as T);
  }

  private rawRequest(path: string, init: { method: "GET" | "POST" | "DELETE"; body?: string }) {
    return requestWithAlpacaRetry(
      () =>
        this.fetchImpl(new URL(path, this.config.baseUrl).toString(), {
          method: init.method,
          headers: {
            "APCA-API-KEY-ID": this.config.apiKeyId,
            "APCA-API-SECRET-KEY": this.config.apiSecretKey,
            ...(init.body ? { "Content-Type": "application/json" } : {})
          },
          ...(init.body ? { body: init.body } : {})
        }),
      this.retryConfig
    );
  }

  private nextClientOrderSequence(): number {
    this.clientOrderSequence = (this.clientOrderSequence % 999_999) + 1;
    return this.clientOrderSequence;
  }
}

function toAlpacaOrderRequest(intent: OrderIntent, clientOrderId: string): Record<string, string> {
  const request: Record<string, string> = {
    symbol: intent.symbol,
    qty: String(intent.quantity),
    side: intent.side,
    type: intent.type,
    time_in_force: "day",
    client_order_id: clientOrderId
  };

  if (intent.type === "limit") {
    if (intent.limitPrice === undefined) {
      throw new Error("Limit orders require limitPrice for Alpaca trading.");
    }

    request.limit_price = String(intent.limitPrice);
  }

  return request;
}

function buildClientOrderId(intent: OrderIntent, sequence: number, now = Date.now()): string {
  const strategyId = sanitizeClientOrderPart(intent.strategyId, 20);
  const symbol = sanitizeClientOrderPart(intent.symbol, 10);
  return `bot-${strategyId}-${symbol}-${now.toString(36)}-${sequence.toString(36)}`;
}

function sanitizeClientOrderPart(value: string, maxLength: number): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);

  return sanitized.length > 0 ? sanitized : "unknown";
}

function toOrder(alpacaOrder: AlpacaOrderResponse, intent?: OrderIntent): Order {
  const filledQuantity = optionalNumber(alpacaOrder.filled_qty);
  const averageFillPrice = optionalNumber(alpacaOrder.filled_avg_price);

  return {
    id: stringValue(alpacaOrder.id, "Alpaca order.id"),
    intent:
      intent ??
      ({
        symbol: stringValue(alpacaOrder.symbol, "Alpaca order.symbol"),
        side: alpacaOrder.side,
        type: alpacaOrder.type === "limit" ? "limit" : "market",
        quantity: optionalNumber(alpacaOrder.qty) ?? 0,
        ...(alpacaOrder.limit_price
          ? { limitPrice: numberValue(alpacaOrder.limit_price, "Alpaca order.limit_price") }
          : {}),
        reason: "Alpaca order lookup.",
        strategyId: alpacaOrder.client_order_id ?? "unknown"
      } satisfies OrderIntent),
    status: toOrderStatus(alpacaOrder.status),
    createdAt: dateValue(alpacaOrder.created_at, "Alpaca order.created_at"),
    updatedAt: alpacaOrder.updated_at
      ? dateValue(alpacaOrder.updated_at, "Alpaca order.updated_at")
      : dateValue(alpacaOrder.created_at, "Alpaca order.created_at"),
    ...(filledQuantity !== undefined ? { filledQuantity } : {}),
    ...(averageFillPrice !== undefined ? { averageFillPrice } : {})
  };
}

function toSyntheticFill(alpacaOrder: AlpacaOrderResponse, intent: OrderIntent): Fill[] {
  const quantity = optionalNumber(alpacaOrder.filled_qty) ?? 0;
  const price = optionalNumber(alpacaOrder.filled_avg_price) ?? 0;
  if (quantity <= 0 || price <= 0) {
    return [];
  }

  return [
    {
      orderId: alpacaOrder.id,
      symbol: intent.symbol,
      side: intent.side,
      quantity,
      price,
      fee: 0,
      timestamp: alpacaOrder.updated_at
        ? dateValue(alpacaOrder.updated_at, "Alpaca order.updated_at")
        : dateValue(alpacaOrder.created_at, "Alpaca order.created_at")
    }
  ];
}

function toOrderStatus(status: string): Order["status"] {
  switch (status) {
    case "new":
    case "pending_new":
    case "accepted":
      return "accepted";
    case "partially_filled":
      return "partially-filled";
    case "filled":
      return "filled";
    case "canceled":
    case "expired":
    case "done_for_day":
      return "cancelled";
    case "rejected":
    case "stopped":
    case "suspended":
      return "rejected";
    default:
      return "new";
  }
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return numberValue(value, "Alpaca numeric value");
}

function numberValue(value: unknown, label: string): number {
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return number;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function dateValue(value: unknown, label: string): Date {
  const raw = stringValue(value, label);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }

  return date;
}

function isoDateValue(value: unknown, label: string): string {
  const raw = stringValue(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${label} must use YYYY-MM-DD.`);
  return raw;
}

function sessionTimeValue(value: unknown, label: string): string {
  const raw = stringValue(value, label);
  const match = /^(\d{2}):(\d{2})/.exec(raw);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`${label} must contain a valid HH:MM time.`);
  }
  return `${match[1]}:${match[2]}`;
}
