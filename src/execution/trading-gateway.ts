import type { Order, OrderIntent, Position, TradingMode } from "../core/types.js";
import type { ExecutionResult, OrderExecutor } from "./interfaces.js";

export type TradingGatewayGateStatus = "ready" | "warning" | "blocked";

export interface TradingGatewayGate {
  id: string;
  label: string;
  detail: string;
  status: TradingGatewayGateStatus;
}

export interface TradingGatewayConfig {
  requestedMode: TradingMode;
  liveTradingEnabled: boolean;
  operatorConfirmedLive: boolean;
  killSwitchArmed: boolean;
  maxDailyLossBreached: boolean;
  brokerCredentialsConfigured: boolean;
  stopAfterBreakEven?: boolean;
  breakEvenTargetMet?: boolean;
  requirePriorBreakEvenAudit?: boolean;
  priorBreakEvenAuditMet?: boolean;
  priorBreakEvenAuditDayCount?: number;
  allowBreakEvenExitOrders?: boolean;
  openPositions?: Position[];
}

export interface TradingGatewayReadiness {
  mode: TradingMode;
  executable: boolean;
  status: TradingGatewayGateStatus;
  gates: TradingGatewayGate[];
}

export class TradingGateway implements OrderExecutor {
  readonly mode: TradingMode;

  constructor(
    private readonly executor: OrderExecutor,
    private readonly config: TradingGatewayConfig
  ) {
    this.mode = config.requestedMode;
  }

  async placeOrder(intent: OrderIntent): Promise<ExecutionResult> {
    const readiness = buildTradingGatewayReadiness(this.config);
    if (!readiness.executable) {
      if (canBypassBreakEvenLock(intent, this.config, readiness)) {
        return this.executor.placeOrder(intent);
      }

      return {
        order: {
          id: `blocked-${Date.now()}`,
          intent,
          status: "rejected",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        fills: [],
        rawResponse: {
          blocked: true,
          reason: "Trading gateway readiness gates blocked execution.",
          readiness
        }
      };
    }

    return this.executor.placeOrder(intent);
  }

  async cancelOrder(orderId: string): Promise<Order> {
    return this.executor.cancelOrder(orderId);
  }

  async getOrder(orderId: string): Promise<Order | undefined> {
    return this.executor.getOrder(orderId);
  }

  getReadiness(): TradingGatewayReadiness {
    return buildTradingGatewayReadiness(this.config);
  }
}

export function buildTradingGatewayReadiness(
  config: TradingGatewayConfig
): TradingGatewayReadiness {
  const gates: TradingGatewayGate[] = [
    {
      id: "kill-switch",
      label: "Kill switch",
      detail: config.killSwitchArmed
        ? "Kill switch is armed and can stop trading."
        : "Kill switch is not armed.",
      status: config.killSwitchArmed ? "ready" : "blocked"
    },
    {
      id: "daily-loss",
      label: "Daily loss",
      detail: config.maxDailyLossBreached
        ? "Daily loss limit has been reached."
        : "Daily loss limit has not been reached.",
      status: config.maxDailyLossBreached ? "blocked" : "ready"
    },
    {
      id: "break-even-lock",
      label: "Break-even lock",
      detail:
        config.stopAfterBreakEven && config.breakEvenTargetMet
          ? "Day break-even target is met; new execution is locked."
          : config.stopAfterBreakEven
            ? "Execution remains open until the break-even target is met."
            : "Break-even lock is disabled.",
      status:
        config.stopAfterBreakEven && config.breakEvenTargetMet
          ? "blocked"
          : config.stopAfterBreakEven
            ? "ready"
            : "warning"
    },
    {
      id: "prior-break-even-audit",
      label: "Prior break-even audit",
      detail: priorBreakEvenAuditDetail(config),
      status: priorBreakEvenAuditStatus(config)
    }
  ];

  if (config.requestedMode === "live") {
    gates.push(
      {
        id: "live-enabled",
        label: "Live trading flag",
        detail: config.liveTradingEnabled
          ? "Live trading is enabled by explicit configuration."
          : "Live trading is disabled by configuration.",
        status: config.liveTradingEnabled ? "ready" : "blocked"
      },
      {
        id: "operator-confirmation",
        label: "Operator confirmation",
        detail: config.operatorConfirmedLive
          ? "Operator confirmed live execution."
          : "Operator has not confirmed live execution.",
        status: config.operatorConfirmedLive ? "ready" : "blocked"
      },
      {
        id: "broker-credentials",
        label: "Broker credentials",
        detail: config.brokerCredentialsConfigured
          ? "Broker credentials are configured."
          : "Broker credentials are missing.",
        status: config.brokerCredentialsConfigured ? "ready" : "blocked"
      }
    );
  } else {
    gates.push({
      id: "execution-mode",
      label: "Execution mode",
      detail:
        config.requestedMode === "paper"
          ? "Paper trading can execute simulated orders."
          : "Backtest mode is research-only and cannot place live orders.",
      status: config.requestedMode === "paper" ? "warning" : "blocked"
    });
  }

  const status = mostSevere(gates.map((gate) => gate.status));

  return {
    mode: config.requestedMode,
    executable:
      status !== "blocked" &&
      (config.requestedMode === "paper" ||
        (config.requestedMode === "live" &&
          config.liveTradingEnabled &&
          config.operatorConfirmedLive &&
          config.brokerCredentialsConfigured)),
    status,
    gates
  };
}

function priorBreakEvenAuditStatus(config: TradingGatewayConfig): TradingGatewayGateStatus {
  if (!config.requirePriorBreakEvenAudit) {
    return "warning";
  }

  if ((config.priorBreakEvenAuditDayCount ?? 0) === 0) {
    return "blocked";
  }

  return config.priorBreakEvenAuditMet ? "ready" : "blocked";
}

function priorBreakEvenAuditDetail(config: TradingGatewayConfig): string {
  if (!config.requirePriorBreakEvenAudit) {
    return "Prior break-even audit gate is disabled.";
  }

  const dayCount = config.priorBreakEvenAuditDayCount ?? 0;
  if (dayCount === 0) {
    return "No prior daily break-even audit records are available.";
  }

  return config.priorBreakEvenAuditMet
    ? `${dayCount} prior audited day${dayCount === 1 ? "" : "s"} met break-even.`
    : "At least one prior audited day missed break-even.";
}

function mostSevere(statuses: TradingGatewayGateStatus[]): TradingGatewayGateStatus {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("warning")) return "warning";
  return "ready";
}

function canBypassBreakEvenLock(
  intent: OrderIntent,
  config: TradingGatewayConfig,
  readiness: TradingGatewayReadiness
): boolean {
  if (
    !config.allowBreakEvenExitOrders ||
    !config.stopAfterBreakEven ||
    !config.breakEvenTargetMet
  ) {
    return false;
  }

  const blockedGateIds = readiness.gates
    .filter((gate) => gate.status === "blocked")
    .map((gate) => gate.id);
  if (blockedGateIds.length !== 1 || blockedGateIds[0] !== "break-even-lock") {
    return false;
  }

  return isReduceOnlyExitIntent(intent, config.openPositions ?? []);
}

function isReduceOnlyExitIntent(intent: OrderIntent, positions: Position[]): boolean {
  const position = positions.find((candidate) => candidate.symbol === intent.symbol);
  if (!position) {
    return false;
  }

  if (position.quantity > 0) {
    return intent.side === "sell" && intent.quantity <= position.quantity;
  }

  if (position.quantity < 0) {
    return intent.side === "buy" && intent.quantity <= Math.abs(position.quantity);
  }

  return false;
}
