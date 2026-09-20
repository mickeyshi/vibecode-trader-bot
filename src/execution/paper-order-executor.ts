import type { Fill, Order, OrderIntent, TradingMode } from "../core/types.js";
import type { InMemoryPortfolioStore } from "../portfolio/in-memory-portfolio-store.js";
import type { ExecutionResult, OrderExecutor } from "./interfaces.js";

export interface PaperOrderExecutorConfig {
  feeRate: number;
  slippageBps: number;
  spreadBps?: number;
  fillRatio?: number;
  skipFillEvery?: number;
  maxVolumeParticipationPct?: number;
  marketImpactBpsAtMaxParticipation?: number;
}

export interface PaperExecutionMarketSnapshot {
  price: number;
  volume?: number;
  timestamp?: Date;
}

export class PaperOrderExecutor implements OrderExecutor {
  readonly mode: TradingMode = "paper";
  private nextOrderNumber = 1;
  private readonly consumedVolume = new Map<string, number>();

  constructor(
    private readonly portfolioStore: InMemoryPortfolioStore,
    private readonly getMarketPrice: (
      symbol: string
    ) => Promise<number | PaperExecutionMarketSnapshot>,
    private readonly config: PaperOrderExecutorConfig
  ) {
    validateLiquidityConfig(config);
  }

  async placeOrder(intent: OrderIntent): Promise<ExecutionResult> {
    const now = new Date();
    const orderNumber = this.nextOrderNumber++;
    const fillRatio = this.config.fillRatio ?? 1;
    const order: Order = {
      id: `paper-${orderNumber}`,
      intent,
      status: "filled",
      createdAt: now,
      updatedAt: now
    };

    if (this.shouldSkipFill(orderNumber) || fillRatio <= 0) {
      const skippedOrder = { ...order, status: "cancelled" as const };
      await this.portfolioStore.saveOrder(skippedOrder);

      return {
        order: skippedOrder,
        fills: [],
        rawResponse: { simulated: true, skipped: true }
      };
    }

    const market = normalizeMarketSnapshot(await this.getMarketPrice(intent.symbol));
    const marketPrice = market.price;
    const volumeLimit = this.volumeLimit(intent.symbol, market, intent.quantity * fillRatio);
    const fillQuantity = Math.min(
      intent.quantity,
      intent.quantity * fillRatio,
      volumeLimit.quantity
    );
    if (fillQuantity <= 0) {
      const skippedOrder = { ...order, status: "cancelled" as const };
      await this.portfolioStore.saveOrder(skippedOrder);
      return {
        order: skippedOrder,
        fills: [],
        rawResponse: { simulated: true, skipped: true, reason: "insufficient-market-volume" }
      };
    }
    const impactBps = volumeLimit.enabled
      ? (this.config.marketImpactBpsAtMaxParticipation ?? 0) * volumeLimit.utilization
      : 0;
    const price = applyExecutionCosts(
      marketPrice,
      intent.side,
      this.config.slippageBps + impactBps,
      this.config.spreadBps ?? 0
    );
    const fee = fillQuantity * price * this.config.feeRate;
    const fill: Fill = {
      orderId: order.id,
      symbol: intent.symbol,
      side: intent.side,
      quantity: fillQuantity,
      price,
      fee,
      timestamp: now
    };
    const filledOrder: Order = {
      ...order,
      status: fillQuantity < intent.quantity ? "partially-filled" : "filled",
      filledQuantity: fillQuantity,
      averageFillPrice: price
    };

    await this.portfolioStore.saveFill(fill);
    await this.portfolioStore.saveOrder(filledOrder);
    if (volumeLimit.key) {
      this.consumedVolume.set(
        volumeLimit.key,
        (this.consumedVolume.get(volumeLimit.key) ?? 0) + fillQuantity
      );
    }

    return {
      order: filledOrder,
      fills: [fill],
      rawResponse: {
        marketPrice,
        simulated: true,
        fillRatio,
        volumeLimited: volumeLimit.capped,
        impactBps
      }
    };
  }

  async cancelOrder(orderId: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new Error(`Unknown paper order: ${orderId}`);
    }

    return {
      ...order,
      status: "cancelled",
      updatedAt: new Date()
    };
  }

  async getOrder(orderId: string): Promise<Order | undefined> {
    return this.portfolioStore.getOrders().find((order) => order.id === orderId);
  }

  private shouldSkipFill(orderNumber: number): boolean {
    return (
      this.config.skipFillEvery !== undefined &&
      this.config.skipFillEvery > 0 &&
      orderNumber % this.config.skipFillEvery === 0
    );
  }

  private volumeLimit(
    symbol: string,
    market: PaperExecutionMarketSnapshot,
    requestedQuantity: number
  ): { quantity: number; enabled: boolean; capped: boolean; utilization: number; key?: string } {
    const participationPct = this.config.maxVolumeParticipationPct;
    if (participationPct === undefined) {
      return {
        quantity: requestedQuantity,
        enabled: false,
        capped: false,
        utilization: 0
      };
    }
    if (market.volume === undefined || !Number.isFinite(market.volume) || market.volume < 0) {
      throw new Error("A finite non-negative market volume is required for participation limits.");
    }
    const key = `${symbol}|${market.timestamp?.toISOString() ?? `order-${this.nextOrderNumber - 1}`}`;
    const capacity = market.volume * (participationPct / 100);
    const consumed = this.consumedVolume.get(key) ?? 0;
    const remaining = Math.max(0, capacity - consumed);
    const quantity = Math.min(requestedQuantity, remaining);
    return {
      quantity,
      enabled: true,
      capped: quantity < requestedQuantity,
      utilization: capacity > 0 ? (consumed + quantity) / capacity : 0,
      key
    };
  }
}

function validateLiquidityConfig(config: PaperOrderExecutorConfig): void {
  if (
    config.maxVolumeParticipationPct !== undefined &&
    (!Number.isFinite(config.maxVolumeParticipationPct) ||
      config.maxVolumeParticipationPct <= 0 ||
      config.maxVolumeParticipationPct > 100)
  ) {
    throw new Error("Max volume participation must be greater than 0 and at most 100 percent.");
  }
  if (
    config.marketImpactBpsAtMaxParticipation !== undefined &&
    (!Number.isFinite(config.marketImpactBpsAtMaxParticipation) ||
      config.marketImpactBpsAtMaxParticipation < 0)
  ) {
    throw new Error("Market impact must be finite and non-negative.");
  }
  if (
    config.marketImpactBpsAtMaxParticipation !== undefined &&
    config.maxVolumeParticipationPct === undefined
  ) {
    throw new Error("Market impact requires a max volume participation setting.");
  }
}

function normalizeMarketSnapshot(
  value: number | PaperExecutionMarketSnapshot
): PaperExecutionMarketSnapshot {
  const snapshot = typeof value === "number" ? { price: value } : value;
  if (!Number.isFinite(snapshot.price) || snapshot.price <= 0) {
    throw new Error("Paper execution market price must be positive and finite.");
  }
  return snapshot;
}

function applyExecutionCosts(
  price: number,
  side: "buy" | "sell",
  slippageBps: number,
  spreadBps: number
): number {
  const adjustment = slippageBps / 10_000 + spreadBps / 20_000;
  return side === "buy" ? price * (1 + adjustment) : price * (1 - adjustment);
}
