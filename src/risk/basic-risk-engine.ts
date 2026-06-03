import type { OrderIntent } from "../core/types.js";
import type { RiskContext, RiskDecision, RiskEngine } from "./interfaces.js";

export interface BasicRiskConfig {
  maxOrderNotional: number;
  maxPositionNotional: number;
  maxDailyLossPct: number;
  blockHighImpactEventsAtOrAbove: number;
  allowShort?: boolean;
  maxGrossLeverage?: number;
  estimatedFeeRate?: number;
  estimatedSlippageBps?: number;
  estimatedSpreadBps?: number;
}

export class BasicRiskEngine implements RiskEngine {
  constructor(private readonly config: BasicRiskConfig) {}

  async evaluate(intent: OrderIntent, context: RiskContext): Promise<RiskDecision> {
    const appliedRules: string[] = [];
    const price = intent.limitPrice;

    if (!price || price <= 0) {
      return reject("Order intent must include a positive limitPrice for first-pass risk checks.", [
        "require-priced-intent"
      ]);
    }

    appliedRules.push("max-order-notional");
    const executionPrice = estimateExecutionPrice(
      price,
      intent.side,
      this.config.estimatedSlippageBps ?? 0,
      this.config.estimatedSpreadBps ?? 0
    );
    const orderNotional = intent.quantity * executionPrice;
    const estimatedFee = orderNotional * (this.config.estimatedFeeRate ?? 0);
    const estimatedCashCost = orderNotional + estimatedFee;
    if (orderNotional > this.config.maxOrderNotional) {
      return reject(
        `Order notional ${orderNotional.toFixed(2)} exceeds max order notional.`,
        appliedRules
      );
    }

    appliedRules.push("max-position-notional");
    const currentPosition = context.openPositions.find(
      (position) => position.symbol === intent.symbol
    );
    const signedQuantity = intent.side === "buy" ? intent.quantity : -intent.quantity;
    const nextQuantity = (currentPosition?.quantity ?? 0) + signedQuantity;

    appliedRules.push("cash-and-short-guard");
    if (intent.side === "buy" && estimatedCashCost > context.buyingPower) {
      return reject(
        `Estimated buy cost ${estimatedCashCost.toFixed(2)} exceeds buying power ${context.buyingPower.toFixed(2)}.`,
        appliedRules
      );
    }

    if (!this.config.allowShort && nextQuantity < -1e-10) {
      return reject("Order would create a short position, but shorting is disabled.", appliedRules);
    }

    const nextPositionNotional = Math.abs(nextQuantity * price);
    if (nextPositionNotional > this.config.maxPositionNotional) {
      return reject(
        `Projected position notional ${nextPositionNotional.toFixed(2)} exceeds max position notional.`,
        appliedRules
      );
    }

    if (this.config.maxGrossLeverage !== undefined) {
      appliedRules.push("max-gross-leverage");
      const currentGrossExposure = context.openPositions.reduce(
        (sum, position) =>
          position.symbol === intent.symbol
            ? sum
            : sum + Math.abs(position.quantity * position.markPrice),
        0
      );
      const projectedGrossExposure = currentGrossExposure + nextPositionNotional;
      const maxGrossExposure = context.accountEquity * this.config.maxGrossLeverage;

      if (projectedGrossExposure > maxGrossExposure) {
        return reject(
          `Projected gross exposure ${projectedGrossExposure.toFixed(2)} exceeds max leverage exposure ${maxGrossExposure.toFixed(2)}.`,
          appliedRules
        );
      }
    }

    appliedRules.push("max-daily-loss");
    const maxDailyLoss = context.accountEquity * this.config.maxDailyLossPct;
    if (context.dailyRealizedPnl <= -maxDailyLoss) {
      return reject("Daily realized loss limit has been reached.", appliedRules);
    }

    appliedRules.push("high-impact-event-block");
    const blockingEvent = context.recentEvents.find(
      (event) => event.importance >= this.config.blockHighImpactEventsAtOrAbove
    );
    if (blockingEvent) {
      return reject(`High-impact event blocks trading: ${blockingEvent.headline}`, appliedRules);
    }

    return {
      approved: true,
      intent,
      reason: "Approved by basic risk rules.",
      appliedRules
    };
  }
}

function reject(reason: string, appliedRules: string[]): RiskDecision {
  return {
    approved: false,
    reason,
    appliedRules
  };
}

function estimateExecutionPrice(
  price: number,
  side: "buy" | "sell",
  slippageBps: number,
  spreadBps: number
): number {
  const adjustment = slippageBps / 10_000 + spreadBps / 20_000;
  return side === "buy" ? price * (1 + adjustment) : price * (1 - adjustment);
}
