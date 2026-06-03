import type { Fill, Order, OrderIntent, TradingMode } from "../core/types.js";
import type { InMemoryPortfolioStore } from "../portfolio/in-memory-portfolio-store.js";
import type { ExecutionResult, OrderExecutor } from "./interfaces.js";

export interface PaperOrderExecutorConfig {
  feeRate: number;
  slippageBps: number;
  spreadBps?: number;
  fillRatio?: number;
  skipFillEvery?: number;
}

export class PaperOrderExecutor implements OrderExecutor {
  readonly mode: TradingMode = "paper";
  private nextOrderNumber = 1;

  constructor(
    private readonly portfolioStore: InMemoryPortfolioStore,
    private readonly getMarketPrice: (symbol: string) => Promise<number>,
    private readonly config: PaperOrderExecutorConfig
  ) {}

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

    const marketPrice = await this.getMarketPrice(intent.symbol);
    const price = applyExecutionCosts(
      marketPrice,
      intent.side,
      this.config.slippageBps,
      this.config.spreadBps ?? 0
    );
    const fillQuantity = Math.min(intent.quantity, intent.quantity * fillRatio);
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
      status: fillQuantity < intent.quantity ? "partially-filled" : "filled"
    };

    await this.portfolioStore.saveFill(fill);
    await this.portfolioStore.saveOrder(filledOrder);

    return {
      order: filledOrder,
      fills: [fill],
      rawResponse: { marketPrice, simulated: true, fillRatio }
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
