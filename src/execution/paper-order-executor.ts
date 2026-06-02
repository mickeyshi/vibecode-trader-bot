import type { Fill, Order, OrderIntent, TradingMode } from "../core/types.js";
import type { InMemoryPortfolioStore } from "../portfolio/in-memory-portfolio-store.js";
import type { ExecutionResult, OrderExecutor } from "./interfaces.js";

export interface PaperOrderExecutorConfig {
  feeRate: number;
  slippageBps: number;
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
    const order: Order = {
      id: `paper-${this.nextOrderNumber++}`,
      intent,
      status: "filled",
      createdAt: now,
      updatedAt: now
    };

    const marketPrice = await this.getMarketPrice(intent.symbol);
    const price = applySlippage(marketPrice, intent.side, this.config.slippageBps);
    const fee = intent.quantity * price * this.config.feeRate;
    const fill: Fill = {
      orderId: order.id,
      symbol: intent.symbol,
      side: intent.side,
      quantity: intent.quantity,
      price,
      fee,
      timestamp: now
    };

    await this.portfolioStore.saveOrder(order);
    await this.portfolioStore.saveFill(fill);

    return {
      order,
      fills: [fill],
      rawResponse: { marketPrice, simulated: true }
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
}

function applySlippage(price: number, side: "buy" | "sell", slippageBps: number): number {
  const adjustment = slippageBps / 10_000;
  return side === "buy" ? price * (1 + adjustment) : price * (1 - adjustment);
}
