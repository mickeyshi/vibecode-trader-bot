import type { Fill, Order, Position } from "../core/types.js";
import type { AccountSnapshot, PortfolioStore } from "./interfaces.js";

export interface InMemoryPortfolioStoreOptions {
  allowShort?: boolean;
  allowNegativeCash?: boolean;
}

export class InMemoryPortfolioStore implements PortfolioStore {
  private cash: number;
  private realizedPnl = 0;
  private readonly orders = new Map<string, Order>();
  private readonly fills: Fill[] = [];
  private readonly positions = new Map<string, Position>();
  private readonly options: Required<InMemoryPortfolioStoreOptions>;

  constructor(
    startingCash: number,
    private readonly currency = "USD",
    options: InMemoryPortfolioStoreOptions | boolean = {}
  ) {
    this.cash = startingCash;
    this.options =
      typeof options === "boolean"
        ? { allowShort: options, allowNegativeCash: false }
        : { allowShort: false, allowNegativeCash: false, ...options };
  }

  async saveOrder(order: Order): Promise<void> {
    this.orders.set(order.id, order);
  }

  async saveFill(fill: Fill): Promise<void> {
    validateFill(fill);

    const signedQuantity = fill.side === "buy" ? fill.quantity : -fill.quantity;
    const current = this.positions.get(fill.symbol);
    const nextQuantity = (current?.quantity ?? 0) + signedQuantity;

    if (!this.options.allowShort && nextQuantity < -1e-10) {
      throw new Error(`Short positions are disabled; fill would short ${fill.symbol}.`);
    }

    const cashDelta =
      fill.side === "buy"
        ? -(fill.quantity * fill.price + fill.fee)
        : fill.quantity * fill.price - fill.fee;
    const nextCash = this.cash + cashDelta;
    if (!this.options.allowNegativeCash && nextCash < -1e-10) {
      throw new Error(`Fill would create negative cash for ${fill.symbol}.`);
    }

    const nextRealizedPnl = this.realizedPnl + calculateRealizedPnl(current, fill);

    this.fills.push(fill);
    this.cash = nextCash;
    this.realizedPnl = nextRealizedPnl;

    if (Math.abs(nextQuantity) < 1e-10) {
      this.positions.delete(fill.symbol);
      return;
    }

    const averageEntryPrice = calculateAverageEntryPrice(
      current,
      fill,
      signedQuantity,
      nextQuantity
    );
    this.positions.set(fill.symbol, {
      symbol: fill.symbol,
      quantity: nextQuantity,
      averageEntryPrice,
      markPrice: fill.price,
      unrealizedPnl: (fill.price - averageEntryPrice) * nextQuantity,
      updatedAt: fill.timestamp
    });
  }

  async getOpenPositions(): Promise<Position[]> {
    return [...this.positions.values()];
  }

  async getAccountSnapshot(): Promise<AccountSnapshot> {
    const positionValue = [...this.positions.values()].reduce(
      (sum, position) => sum + position.quantity * position.markPrice,
      0
    );
    const unrealizedPnl = [...this.positions.values()].reduce(
      (sum, position) => sum + position.unrealizedPnl,
      0
    );
    const grossExposure = [...this.positions.values()].reduce(
      (sum, position) => sum + Math.abs(position.quantity * position.markPrice),
      0
    );

    return {
      equity: this.cash + positionValue,
      cash: this.cash,
      buyingPower: this.cash,
      realizedPnl: this.realizedPnl,
      unrealizedPnl,
      positionValue,
      grossExposure,
      currency: this.currency,
      timestamp: new Date()
    };
  }

  getOrders(): Order[] {
    return [...this.orders.values()];
  }

  getFills(): Fill[] {
    return [...this.fills];
  }

  markPrice(symbol: string, price: number, updatedAt = new Date()): void {
    const position = this.positions.get(symbol);
    if (!position) {
      return;
    }

    this.positions.set(symbol, {
      ...position,
      markPrice: price,
      unrealizedPnl: (price - position.averageEntryPrice) * position.quantity,
      updatedAt
    });
  }
}

function calculateAverageEntryPrice(
  current: Position | undefined,
  fill: Fill,
  signedQuantity: number,
  nextQuantity: number
): number {
  if (!current) {
    return calculateFeeAdjustedEntryPrice(fill);
  }

  const currentDirection = Math.sign(current.quantity);
  const fillDirection = Math.sign(signedQuantity);

  if (currentDirection !== fillDirection) {
    return Math.sign(nextQuantity) === currentDirection
      ? current.averageEntryPrice
      : calculateFeeAdjustedEntryPrice(fill);
  }

  const currentCost = current.averageEntryPrice * Math.abs(current.quantity);
  const fillCost = calculateFeeAdjustedEntryPrice(fill) * Math.abs(signedQuantity);

  return (currentCost + fillCost) / Math.abs(nextQuantity);
}

function calculateRealizedPnl(current: Position | undefined, fill: Fill): number {
  if (!current) {
    return 0;
  }

  const signedQuantity = fill.side === "buy" ? fill.quantity : -fill.quantity;
  if (Math.sign(current.quantity) === Math.sign(signedQuantity)) {
    return 0;
  }

  const closedQuantity = Math.min(Math.abs(current.quantity), fill.quantity);
  const allocatedExitFee = fill.fee * (closedQuantity / fill.quantity);
  const grossPnl =
    current.quantity > 0
      ? (fill.price - current.averageEntryPrice) * closedQuantity
      : (current.averageEntryPrice - fill.price) * closedQuantity;

  return grossPnl - allocatedExitFee;
}

function calculateFeeAdjustedEntryPrice(fill: Fill): number {
  const feePerUnit = fill.fee / fill.quantity;
  return fill.side === "buy" ? fill.price + feePerUnit : fill.price - feePerUnit;
}

function validateFill(fill: Fill): void {
  if (fill.quantity <= 0 || !Number.isFinite(fill.quantity)) {
    throw new Error("Fill quantity must be a positive finite number.");
  }

  if (fill.price <= 0 || !Number.isFinite(fill.price)) {
    throw new Error("Fill price must be a positive finite number.");
  }

  if (fill.fee < 0 || !Number.isFinite(fill.fee)) {
    throw new Error("Fill fee must be a non-negative finite number.");
  }
}
