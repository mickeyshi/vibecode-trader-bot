import type {
  AlertEvent,
  DecisionTrace,
  ObservabilityLog,
  ObservabilityMetric,
  ObservabilitySink,
  ObservabilitySnapshot
} from "./interfaces.js";

export class InMemoryObservabilitySink implements ObservabilitySink {
  private readonly logs: ObservabilityLog[] = [];
  private readonly metrics: ObservabilityMetric[] = [];
  private readonly decisionTraces: DecisionTrace[] = [];
  private readonly alerts: AlertEvent[] = [];

  log(entry: ObservabilityLog): void {
    this.logs.push(entry);
  }

  metric(metric: ObservabilityMetric): void {
    this.metrics.push(metric);
  }

  decisionTrace(trace: DecisionTrace): void {
    this.decisionTraces.push(trace);
  }

  alert(alert: AlertEvent): void {
    this.alerts.push(alert);
  }

  snapshot(): ObservabilitySnapshot {
    return {
      logs: [...this.logs],
      metrics: [...this.metrics],
      decisionTraces: [...this.decisionTraces],
      alerts: [...this.alerts]
    };
  }
}
