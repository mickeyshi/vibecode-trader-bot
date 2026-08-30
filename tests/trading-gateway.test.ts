import { describe, expect, it } from "vitest";
import type { Order, OrderIntent } from "../src/core/types.js";
import { TradingGateway, buildTradingGatewayReadiness } from "../src/execution/trading-gateway.js";
import type { ExecutionResult, OrderExecutor } from "../src/execution/interfaces.js";

const intent: OrderIntent = {
  symbol: "SPY",
  side: "buy",
  type: "limit",
  quantity: 1,
  limitPrice: 420,
  reason: "test",
  strategyId: "test-strategy"
};

const exitIntent: OrderIntent = {
  symbol: "SPY",
  side: "sell",
  type: "limit",
  quantity: 1,
  limitPrice: 420,
  reason: "reduce exposure after break-even",
  strategyId: "test-strategy"
};

describe("trading gateway", () => {
  it("allows paper trading while marking it as simulated execution", () => {
    const readiness = buildTradingGatewayReadiness({
      requestedMode: "paper",
      liveTradingEnabled: false,
      operatorConfirmedLive: false,
      killSwitchArmed: true,
      maxDailyLossBreached: false,
      brokerCredentialsConfigured: false
    });

    expect(readiness).toMatchObject({
      mode: "paper",
      executable: true,
      status: "warning"
    });
    expect(readiness.gates.find((gate) => gate.id === "execution-mode")).toMatchObject({
      status: "warning"
    });
  });

  it("blocks live trading until every explicit live gate is ready", async () => {
    const executor = new StubExecutor();
    const gateway = new TradingGateway(executor, {
      requestedMode: "live",
      liveTradingEnabled: true,
      operatorConfirmedLive: false,
      killSwitchArmed: true,
      maxDailyLossBreached: false,
      brokerCredentialsConfigured: true
    });

    const result = await gateway.placeOrder(intent);

    expect(executor.orderCount).toBe(0);
    expect(result.order.status).toBe("rejected");
    expect(result.fills).toEqual([]);
    expect(result.rawResponse).toMatchObject({
      blocked: true,
      readiness: {
        executable: false,
        status: "blocked"
      }
    });
  });

  it("delegates live orders only when live trading is explicitly enabled and safe", async () => {
    const executor = new StubExecutor();
    const gateway = new TradingGateway(executor, {
      requestedMode: "live",
      liveTradingEnabled: true,
      operatorConfirmedLive: true,
      killSwitchArmed: true,
      maxDailyLossBreached: false,
      brokerCredentialsConfigured: true,
      stopAfterBreakEven: true,
      breakEvenTargetMet: false,
      requirePriorBreakEvenAudit: true,
      priorBreakEvenAuditDayCount: 2,
      priorBreakEvenAuditMet: true
    });

    const result = await gateway.placeOrder(intent);

    expect(executor.orderCount).toBe(1);
    expect(result.order.status).toBe("accepted");
    expect(gateway.getReadiness()).toMatchObject({
      executable: true,
      status: "ready"
    });
  });

  it("blocks execution when the daily loss limit is breached", () => {
    const readiness = buildTradingGatewayReadiness({
      requestedMode: "paper",
      liveTradingEnabled: false,
      operatorConfirmedLive: false,
      killSwitchArmed: true,
      maxDailyLossBreached: true,
      brokerCredentialsConfigured: false
    });

    expect(readiness.executable).toBe(false);
    expect(readiness.gates.find((gate) => gate.id === "daily-loss")).toMatchObject({
      status: "blocked"
    });
  });

  it("locks execution after the day break-even target is met when configured", () => {
    const readiness = buildTradingGatewayReadiness({
      requestedMode: "paper",
      liveTradingEnabled: false,
      operatorConfirmedLive: false,
      killSwitchArmed: true,
      maxDailyLossBreached: false,
      brokerCredentialsConfigured: false,
      stopAfterBreakEven: true,
      breakEvenTargetMet: true
    });

    expect(readiness.executable).toBe(false);
    expect(readiness.gates.find((gate) => gate.id === "break-even-lock")).toMatchObject({
      status: "blocked"
    });
  });

  it("allows reduce-only exits after break-even when that escape hatch is enabled", async () => {
    const executor = new StubExecutor();
    const gateway = new TradingGateway(executor, {
      requestedMode: "paper",
      liveTradingEnabled: false,
      operatorConfirmedLive: false,
      killSwitchArmed: true,
      maxDailyLossBreached: false,
      brokerCredentialsConfigured: false,
      stopAfterBreakEven: true,
      breakEvenTargetMet: true,
      allowBreakEvenExitOrders: true,
      openPositions: [
        {
          symbol: "SPY",
          quantity: 2,
          averageEntryPrice: 400,
          markPrice: 420,
          unrealizedPnl: 40,
          updatedAt: new Date("2026-06-19T14:30:00.000Z")
        }
      ]
    });

    const result = await gateway.placeOrder(exitIntent);

    expect(executor.orderCount).toBe(1);
    expect(result.order.status).toBe("accepted");
  });

  it("continues to block exposure-increasing orders after break-even", async () => {
    const executor = new StubExecutor();
    const gateway = new TradingGateway(executor, {
      requestedMode: "paper",
      liveTradingEnabled: false,
      operatorConfirmedLive: false,
      killSwitchArmed: true,
      maxDailyLossBreached: false,
      brokerCredentialsConfigured: false,
      stopAfterBreakEven: true,
      breakEvenTargetMet: true,
      allowBreakEvenExitOrders: true,
      openPositions: [
        {
          symbol: "SPY",
          quantity: 2,
          averageEntryPrice: 400,
          markPrice: 420,
          unrealizedPnl: 40,
          updatedAt: new Date("2026-06-19T14:30:00.000Z")
        }
      ]
    });

    const result = await gateway.placeOrder(intent);

    expect(executor.orderCount).toBe(0);
    expect(result.order.status).toBe("rejected");
  });

  it("does not allow break-even exits when another safety gate is blocked", async () => {
    const executor = new StubExecutor();
    const gateway = new TradingGateway(executor, {
      requestedMode: "paper",
      liveTradingEnabled: false,
      operatorConfirmedLive: false,
      killSwitchArmed: false,
      maxDailyLossBreached: false,
      brokerCredentialsConfigured: false,
      stopAfterBreakEven: true,
      breakEvenTargetMet: true,
      allowBreakEvenExitOrders: true,
      openPositions: [
        {
          symbol: "SPY",
          quantity: 2,
          averageEntryPrice: 400,
          markPrice: 420,
          unrealizedPnl: 40,
          updatedAt: new Date("2026-06-19T14:30:00.000Z")
        }
      ]
    });

    const result = await gateway.placeOrder(exitIntent);

    expect(executor.orderCount).toBe(0);
    expect(result.order.status).toBe("rejected");
  });

  it("blocks execution when prior break-even audit is required but missing", () => {
    const readiness = buildTradingGatewayReadiness({
      requestedMode: "paper",
      liveTradingEnabled: false,
      operatorConfirmedLive: false,
      killSwitchArmed: true,
      maxDailyLossBreached: false,
      brokerCredentialsConfigured: false,
      requirePriorBreakEvenAudit: true,
      priorBreakEvenAuditDayCount: 0,
      priorBreakEvenAuditMet: false
    });

    expect(readiness.executable).toBe(false);
    expect(readiness.gates.find((gate) => gate.id === "prior-break-even-audit")).toMatchObject({
      status: "blocked"
    });
  });

  it("allows execution when required prior break-even audit has passed", () => {
    const readiness = buildTradingGatewayReadiness({
      requestedMode: "paper",
      liveTradingEnabled: false,
      operatorConfirmedLive: false,
      killSwitchArmed: true,
      maxDailyLossBreached: false,
      brokerCredentialsConfigured: false,
      requirePriorBreakEvenAudit: true,
      priorBreakEvenAuditDayCount: 2,
      priorBreakEvenAuditMet: true,
      stopAfterBreakEven: true,
      breakEvenTargetMet: false
    });

    expect(readiness.executable).toBe(true);
    expect(readiness.gates.find((gate) => gate.id === "prior-break-even-audit")).toMatchObject({
      status: "ready"
    });
  });
});

class StubExecutor implements OrderExecutor {
  readonly mode = "live";
  orderCount = 0;

  async placeOrder(orderIntent: OrderIntent): Promise<ExecutionResult> {
    this.orderCount += 1;
    const now = new Date("2026-06-19T14:30:00.000Z");
    return {
      order: {
        id: `stub-${this.orderCount}`,
        intent: orderIntent,
        status: "accepted",
        createdAt: now,
        updatedAt: now
      },
      fills: []
    };
  }

  async cancelOrder(orderId: string): Promise<Order> {
    const now = new Date("2026-06-19T14:30:00.000Z");
    return {
      id: orderId,
      intent,
      status: "cancelled",
      createdAt: now,
      updatedAt: now
    };
  }

  async getOrder(): Promise<Order | undefined> {
    return undefined;
  }
}
