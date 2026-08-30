import type { Order, OrderIntent } from "../core/types.js";
import type { RiskDecision } from "../risk/interfaces.js";
import type { StrategySignal } from "../strategies/interfaces.js";

export type ObservabilityLogLevel = "debug" | "info" | "warn" | "error";

export interface ObservabilityLog {
  timestamp: Date;
  level: ObservabilityLogLevel;
  event: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface ObservabilityMetric {
  timestamp: Date;
  name: string;
  value: number;
  unit: "count" | "currency" | "percent" | "ratio";
  tags?: Record<string, string>;
}

export interface DecisionTrace {
  id: string;
  timestamp: Date;
  symbol: string;
  strategyId: string;
  signal: Pick<StrategySignal, "action" | "confidence" | "reason">;
  intent?: OrderIntent;
  riskDecision?: Pick<RiskDecision, "approved" | "reason" | "appliedRules">;
  order?: Pick<Order, "id" | "status">;
  fillCount: number;
  equity: number;
}

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertEvent {
  id: string;
  timestamp: Date;
  severity: AlertSeverity;
  type: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface ObservabilitySnapshot {
  logs: ObservabilityLog[];
  metrics: ObservabilityMetric[];
  decisionTraces: DecisionTrace[];
  alerts: AlertEvent[];
}

export interface ObservabilitySink {
  log(entry: ObservabilityLog): void | Promise<void>;
  metric(metric: ObservabilityMetric): void | Promise<void>;
  decisionTrace(trace: DecisionTrace): void | Promise<void>;
  alert(alert: AlertEvent): void | Promise<void>;
  snapshot?(): ObservabilitySnapshot;
}
