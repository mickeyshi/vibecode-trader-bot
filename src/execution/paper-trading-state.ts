import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { Candle, Order, OrderIntent, Timeframe } from "../core/types.js";

export interface PaperTradingStateOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  status: Order["status"];
  strategyId: string;
  updatedAt: string;
  filledQuantity?: number;
  averageFillPrice?: number;
  reconciliationStatus?: "confirmed-pending" | "lookup-failed" | "not-found";
  reconciledAt?: string;
  reconciliationDetail?: string;
}

export interface PaperTradingStateCandle {
  symbol: string;
  timeframe: Timeframe;
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PaperTradingStateLastExecutedCandle {
  symbol: string;
  closeTime: string;
  orderId: string;
  side: "buy" | "sell";
  strategyId: string;
  updatedAt: string;
}

export interface PaperTradingCoordinatorState {
  version: 1;
  updatedAt: string;
  runCount: number;
  lastRun: {
    startedAt: string;
    completedAt: string;
    symbols: string[];
    cycleCount: number;
    executionCount: number;
    skippedCount: number;
  };
  pendingOrders: PaperTradingStateOrder[];
  candleHistory?: PaperTradingStateCandle[];
  lastExecutedCandles?: PaperTradingStateLastExecutedCandle[];
}

export interface PaperTradingStateStore {
  load(): Promise<PaperTradingCoordinatorState | undefined>;
  save(state: PaperTradingCoordinatorState): Promise<void>;
}

export type SubmissionJournalStatus = "prepared" | "confirmed" | "not-found";

export interface SubmissionJournalEntry {
  idempotencyKey: string;
  intent: OrderIntent;
  status: SubmissionJournalStatus;
  preparedAt: string;
  updatedAt: string;
  brokerOrderId?: string;
  detail?: string;
}

export interface SubmissionJournal {
  prepare(idempotencyKey: string, intent: OrderIntent, now: Date): Promise<void>;
  confirm(idempotencyKey: string, order: Order, now: Date): Promise<void>;
  markNotFound(idempotencyKey: string, detail: string, now: Date): Promise<void>;
  unresolved(): Promise<SubmissionJournalEntry[]>;
}

export class JsonPaperTradingStateStore implements PaperTradingStateStore {
  constructor(private readonly path: string) {}

  async load(): Promise<PaperTradingCoordinatorState | undefined> {
    const raw = await readFile(this.path, "utf8").catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    });

    if (raw === undefined) {
      return undefined;
    }

    return parsePaperTradingCoordinatorState(JSON.parse(raw) as unknown);
  }

  async save(state: PaperTradingCoordinatorState): Promise<void> {
    const validatedState = parsePaperTradingCoordinatorState(state);
    await mkdirParent(this.path);
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx");

    try {
      await handle.writeFile(`${JSON.stringify(validatedState, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, this.path);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export function buildPaperTradingCoordinatorState(input: {
  previous?: PaperTradingCoordinatorState;
  startedAt: Date;
  completedAt: Date;
  symbols: string[];
  cycleCount: number;
  executionCount: number;
  skippedCount: number;
  orders: Order[];
  persistedPendingOrders?: PaperTradingStateOrder[];
  candleHistory?: Candle[];
  lastExecutedCandles?: PaperTradingStateLastExecutedCandle[];
}): PaperTradingCoordinatorState {
  const candleHistory = input.candleHistory?.map((candle) => ({
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    openTime: candle.openTime.toISOString(),
    closeTime: candle.closeTime.toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  }));

  return {
    version: 1,
    updatedAt: input.completedAt.toISOString(),
    runCount: (input.previous?.runCount ?? 0) + 1,
    lastRun: {
      startedAt: input.startedAt.toISOString(),
      completedAt: input.completedAt.toISOString(),
      symbols: [...input.symbols],
      cycleCount: input.cycleCount,
      executionCount: input.executionCount,
      skippedCount: input.skippedCount
    },
    pendingOrders: mergePendingOrders(
      input.persistedPendingOrders ?? [],
      input.orders
        .filter((order) => isPendingOrderStatus(order.status))
        .map((order) => ({
          id: order.id,
          symbol: order.intent.symbol,
          side: order.intent.side,
          quantity: order.intent.quantity,
          status: order.status,
          strategyId: order.intent.strategyId,
          updatedAt: order.updatedAt.toISOString(),
          ...(order.filledQuantity !== undefined ? { filledQuantity: order.filledQuantity } : {}),
          ...(order.averageFillPrice !== undefined
            ? { averageFillPrice: order.averageFillPrice }
            : {})
        }))
    ),
    ...(candleHistory && candleHistory.length > 0 ? { candleHistory } : {}),
    ...(input.lastExecutedCandles && input.lastExecutedCandles.length > 0
      ? { lastExecutedCandles: input.lastExecutedCandles }
      : {})
  };
}

function mergePendingOrders(
  persisted: PaperTradingStateOrder[],
  current: PaperTradingStateOrder[]
): PaperTradingStateOrder[] {
  return [...new Map([...persisted, ...current].map((order) => [order.id, order])).values()].sort(
    (left, right) => left.id.localeCompare(right.id)
  );
}

export function parsePaperTradingCoordinatorState(raw: unknown): PaperTradingCoordinatorState {
  const state = objectValue(raw, "Paper trading coordinator state");
  const lastRun = objectValue(state.lastRun, "Paper trading coordinator state.lastRun");
  const pendingOrders = arrayValue(
    state.pendingOrders,
    "Paper trading coordinator state.pendingOrders"
  );
  const candleHistory =
    state.candleHistory === undefined
      ? []
      : arrayValue(state.candleHistory, "Paper trading coordinator state.candleHistory");
  const lastExecutedCandles =
    state.lastExecutedCandles === undefined
      ? []
      : arrayValue(
          state.lastExecutedCandles,
          "Paper trading coordinator state.lastExecutedCandles"
        );

  return {
    version: versionValue(state.version, "Paper trading coordinator state.version"),
    updatedAt: dateString(state.updatedAt, "Paper trading coordinator state.updatedAt"),
    runCount: nonNegativeInteger(state.runCount, "Paper trading coordinator state.runCount"),
    lastRun: {
      startedAt: dateString(lastRun.startedAt, "Paper trading coordinator state.lastRun.startedAt"),
      completedAt: dateString(
        lastRun.completedAt,
        "Paper trading coordinator state.lastRun.completedAt"
      ),
      symbols: arrayValue(lastRun.symbols, "Paper trading coordinator state.lastRun.symbols").map(
        (symbol, index) =>
          stringValue(symbol, `Paper trading coordinator state.lastRun.symbols[${index}]`)
      ),
      cycleCount: nonNegativeInteger(
        lastRun.cycleCount,
        "Paper trading coordinator state.lastRun.cycleCount"
      ),
      executionCount: nonNegativeInteger(
        lastRun.executionCount,
        "Paper trading coordinator state.lastRun.executionCount"
      ),
      skippedCount: nonNegativeInteger(
        lastRun.skippedCount,
        "Paper trading coordinator state.lastRun.skippedCount"
      )
    },
    pendingOrders: pendingOrders.map((order, index) => parseStateOrder(order, index)),
    ...(candleHistory.length > 0
      ? { candleHistory: candleHistory.map((candle, index) => parseStateCandle(candle, index)) }
      : {}),
    ...(lastExecutedCandles.length > 0
      ? {
          lastExecutedCandles: lastExecutedCandles.map((candle, index) =>
            parseLastExecutedCandle(candle, index)
          )
        }
      : {})
  };
}

function parseStateOrder(raw: unknown, index: number): PaperTradingStateOrder {
  const order = objectValue(raw, `Paper trading coordinator state.pendingOrders[${index}]`);

  return {
    id: stringValue(order.id, `Paper trading coordinator state.pendingOrders[${index}].id`),
    symbol: stringValue(
      order.symbol,
      `Paper trading coordinator state.pendingOrders[${index}].symbol`
    ),
    side: sideValue(order.side, `Paper trading coordinator state.pendingOrders[${index}].side`),
    quantity: numberValue(
      order.quantity,
      `Paper trading coordinator state.pendingOrders[${index}].quantity`
    ),
    status: orderStatusValue(
      order.status,
      `Paper trading coordinator state.pendingOrders[${index}].status`
    ),
    strategyId: stringValue(
      order.strategyId,
      `Paper trading coordinator state.pendingOrders[${index}].strategyId`
    ),
    updatedAt: dateString(
      order.updatedAt,
      `Paper trading coordinator state.pendingOrders[${index}].updatedAt`
    ),
    ...optionalNumberProperty(
      order.filledQuantity,
      `Paper trading coordinator state.pendingOrders[${index}].filledQuantity`,
      "filledQuantity"
    ),
    ...optionalNumberProperty(
      order.averageFillPrice,
      `Paper trading coordinator state.pendingOrders[${index}].averageFillPrice`,
      "averageFillPrice"
    ),
    ...optionalReconciliationStatusProperty(
      order.reconciliationStatus,
      `Paper trading coordinator state.pendingOrders[${index}].reconciliationStatus`
    ),
    ...optionalStringProperty(
      order.reconciledAt,
      `Paper trading coordinator state.pendingOrders[${index}].reconciledAt`,
      "reconciledAt",
      dateString
    ),
    ...optionalStringProperty(
      order.reconciliationDetail,
      `Paper trading coordinator state.pendingOrders[${index}].reconciliationDetail`,
      "reconciliationDetail",
      stringValue
    )
  };
}

function parseStateCandle(raw: unknown, index: number): PaperTradingStateCandle {
  const candle = objectValue(raw, `Paper trading coordinator state.candleHistory[${index}]`);

  return {
    symbol: stringValue(
      candle.symbol,
      `Paper trading coordinator state.candleHistory[${index}].symbol`
    ),
    timeframe: timeframeValue(
      candle.timeframe,
      `Paper trading coordinator state.candleHistory[${index}].timeframe`
    ),
    openTime: dateString(
      candle.openTime,
      `Paper trading coordinator state.candleHistory[${index}].openTime`
    ),
    closeTime: dateString(
      candle.closeTime,
      `Paper trading coordinator state.candleHistory[${index}].closeTime`
    ),
    open: numberValue(candle.open, `Paper trading coordinator state.candleHistory[${index}].open`),
    high: numberValue(candle.high, `Paper trading coordinator state.candleHistory[${index}].high`),
    low: numberValue(candle.low, `Paper trading coordinator state.candleHistory[${index}].low`),
    close: numberValue(
      candle.close,
      `Paper trading coordinator state.candleHistory[${index}].close`
    ),
    volume: numberValue(
      candle.volume,
      `Paper trading coordinator state.candleHistory[${index}].volume`
    )
  };
}

function parseLastExecutedCandle(raw: unknown, index: number): PaperTradingStateLastExecutedCandle {
  const candle = objectValue(raw, `Paper trading coordinator state.lastExecutedCandles[${index}]`);

  return {
    symbol: stringValue(
      candle.symbol,
      `Paper trading coordinator state.lastExecutedCandles[${index}].symbol`
    ),
    closeTime: dateString(
      candle.closeTime,
      `Paper trading coordinator state.lastExecutedCandles[${index}].closeTime`
    ),
    orderId: stringValue(
      candle.orderId,
      `Paper trading coordinator state.lastExecutedCandles[${index}].orderId`
    ),
    side: sideValue(
      candle.side,
      `Paper trading coordinator state.lastExecutedCandles[${index}].side`
    ),
    strategyId: stringValue(
      candle.strategyId,
      `Paper trading coordinator state.lastExecutedCandles[${index}].strategyId`
    ),
    updatedAt: dateString(
      candle.updatedAt,
      `Paper trading coordinator state.lastExecutedCandles[${index}].updatedAt`
    )
  };
}

export type PendingOrderStatus = Extract<Order["status"], "new" | "accepted" | "partially-filled">;

export function isPendingOrderStatus(status: Order["status"]): status is PendingOrderStatus {
  return status === "new" || status === "accepted" || status === "partially-filled";
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function numberValue(value: unknown, label: string): number {
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return number;
}

function optionalNumberProperty<Key extends string>(
  value: unknown,
  label: string,
  key: Key
): Partial<Record<Key, number>> {
  if (value === undefined) {
    return {};
  }

  return {
    [key]: numberValue(value, label)
  } as Partial<Record<Key, number>>;
}

function optionalStringProperty<Key extends string>(
  value: unknown,
  label: string,
  key: Key,
  parse: (value: unknown, label: string) => string
): Partial<Record<Key, string>> {
  if (value === undefined) {
    return {};
  }

  return {
    [key]: parse(value, label)
  } as Partial<Record<Key, string>>;
}

function optionalReconciliationStatusProperty(
  value: unknown,
  label: string
): Partial<Pick<PaperTradingStateOrder, "reconciliationStatus">> {
  if (value === undefined) {
    return {};
  }

  if (value === "confirmed-pending" || value === "lookup-failed" || value === "not-found") {
    return { reconciliationStatus: value };
  }

  throw new Error(`${label} must be confirmed-pending, lookup-failed, or not-found.`);
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = numberValue(value, label);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return number;
}

function dateString(value: unknown, label: string): string {
  const raw = stringValue(value, label);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }

  return raw;
}

function sideValue(value: unknown, label: string): "buy" | "sell" {
  if (value === "buy" || value === "sell") {
    return value;
  }

  throw new Error(`${label} must be buy or sell.`);
}

function timeframeValue(value: unknown, label: string): Timeframe {
  if (value === "1m" || value === "5m" || value === "15m" || value === "1h" || value === "1d") {
    return value;
  }

  throw new Error(`${label} must be a known timeframe.`);
}

function orderStatusValue(value: unknown, label: string): Order["status"] {
  if (
    value === "new" ||
    value === "accepted" ||
    value === "partially-filled" ||
    value === "filled" ||
    value === "rejected" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(`${label} must be a known order status.`);
}

function versionValue(value: unknown, label: string): 1 {
  const version = numberValue(value, label);
  if (version !== 1) {
    throw new Error(`${label} must be 1.`);
  }

  return 1;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function mkdirParent(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== ".") {
    await mkdir(parent, { recursive: true });
  }
}
