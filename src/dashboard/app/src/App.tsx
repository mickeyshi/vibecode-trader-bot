import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type {
  LiveOpsDashboardViewModel,
  LiveOpsPaperRunSummary,
  LiveOpsReadinessStatus,
  LiveOpsRiskLimit
} from "../../live-ops-view-model.js";
import type { DashboardReportViewModel, DashboardRunSummary } from "../../report-view-model.js";
import { sampleLiveOpsDashboard } from "./sample-live-ops.js";
import { sampleDashboardReport } from "./sample-report.js";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const percent = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0
});

export function App(): ReactElement {
  const [liveOps, setLiveOps] = useState<LiveOpsDashboardViewModel>(sampleLiveOpsDashboard);

  useEffect(() => {
    let cancelled = false;

    fetch("/live-ops-snapshot.json")
      .then((response) => (response.ok ? response.json() : undefined))
      .then((snapshot: unknown) => {
        if (!cancelled && snapshot) {
          setLiveOps(snapshot as LiveOpsDashboardViewModel);
        }
      })
      .catch(() => {
        // Missing local snapshots are expected before the first live-ops poll.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return <Dashboard liveOps={liveOps} report={sampleDashboardReport} />;
}

function Dashboard({
  liveOps,
  report
}: {
  liveOps: LiveOpsDashboardViewModel;
  report: DashboardReportViewModel;
}): ReactElement {
  const [activeView, setActiveView] = useState<"operations" | "backtests">("operations");
  const leader = report.runs[0];
  const equityRows = mergeEquitySeries(report);
  const totalAlerts = report.runs.reduce((sum, run) => sum + run.alertCount, 0);
  const totalRiskRejections = report.runs.reduce((sum, run) => sum + run.riskRejectionCount, 0);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Trading operations</p>
          <h1>Prototype Dashboard</h1>
        </div>
        <div className="run-meta">
          <StatusPill status={liveOps.headlineStatus} label={liveOps.headlineStatus} />
          <span>{liveOps.executable ? "executable" : "blocked"}</span>
          <span>{liveOps.mode}</span>
          <span>{new Date(liveOps.updatedAt).toLocaleString()}</span>
        </div>
      </header>

      <nav className="view-tabs" aria-label="Dashboard views">
        <button
          className={activeView === "operations" ? "active" : ""}
          type="button"
          onClick={() => setActiveView("operations")}
        >
          Operations
        </button>
        <button
          className={activeView === "backtests" ? "active" : ""}
          type="button"
          onClick={() => setActiveView("backtests")}
        >
          Backtests
        </button>
      </nav>

      {activeView === "operations" ? (
        <OperationsDashboard liveOps={liveOps} />
      ) : (
        <BacktestDashboard
          equityRows={equityRows}
          leader={leader}
          report={report}
          totalAlerts={totalAlerts}
          totalRiskRejections={totalRiskRejections}
        />
      )}
    </main>
  );
}

function OperationsDashboard({ liveOps }: { liveOps: LiveOpsDashboardViewModel }): ReactElement {
  return (
    <>
      <section className="summary-grid operations-summary" aria-label="Live account summary">
        <Metric label="Equity" value={currency.format(liveOps.account.equity)} />
        <Metric
          label="Break-even Gap"
          value={currency.format(liveOps.breakEven.remainingToBreakEven)}
        />
        <Metric label="Cash" value={currency.format(liveOps.account.cash)} />
        <Metric label="Buying Power" value={currency.format(liveOps.account.buyingPower)} />
        <Metric label="Gross Exposure" value={currency.format(liveOps.account.grossExposure)} />
        <Metric
          label="Day P/L"
          value={currency.format(liveOps.account.dayRealizedPnl + liveOps.account.dayUnrealizedPnl)}
        />
      </section>

      {liveOps.breakEvenAudit ? (
        <section className="summary-grid audit-summary" aria-label="Break-even audit summary">
          <Metric label="Audited Days" value={String(liveOps.breakEvenAudit.dayCount)} />
          <Metric label="Days Met" value={String(liveOps.breakEvenAudit.metCount)} />
          <Metric label="Missed Days" value={String(liveOps.breakEvenAudit.missedCount)} />
          <Metric label="Current Streak" value={String(liveOps.breakEvenAudit.currentStreak)} />
          <Metric label="Best Streak" value={String(liveOps.breakEvenAudit.longestStreak)} />
          <Metric label="Audit Status" value={liveOps.breakEvenAudit.allDaysMet ? "met" : "open"} />
        </section>
      ) : null}

      <section className="layout operations-layout">
        <div className="panel wide">
          <div className="panel-heading">
            <h2>Day Break-even</h2>
            <StatusPill
              status={liveOps.breakEven.remainingToBreakEven === 0 ? "ready" : "warning"}
              label={liveOps.breakEven.remainingToBreakEven === 0 ? "met" : "open"}
            />
          </div>
          <div className="break-even">
            <div className="target-row">
              <span>Starting equity</span>
              <strong>{currency.format(liveOps.breakEven.startingEquity)}</strong>
            </div>
            <div className="target-row">
              <span>Target after fees</span>
              <strong>{currency.format(liveOps.breakEven.targetEquity)}</strong>
            </div>
            <div className="target-row">
              <span>Current equity</span>
              <strong>{currency.format(liveOps.breakEven.currentEquity)}</strong>
            </div>
            <div className="progress-track" aria-label="Break-even progress">
              <div style={{ width: `${liveOps.breakEven.progressPct}%` }} />
            </div>
            <p className="panel-note">
              Prototype target: end the session at or above starting equity after fees. This is a
              control objective, not a profitability guarantee.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Live Gate</h2>
          </div>
          <div className="list">
            {liveOps.readinessChecks.map((check) => (
              <article key={check.id} className="check-row">
                <StatusPill status={check.status} label={check.status} />
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="layout operations-layout">
        <div className="panel">
          <div className="panel-heading">
            <h2>Controls</h2>
          </div>
          <div className="control-grid">
            {liveOps.tradingControls.map((control) => (
              <div key={control.id} className="control-tile">
                <span>{control.label}</span>
                <strong>{control.value}</strong>
                <StatusPill status={control.status} label={control.status} />
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Risk Limits</h2>
          </div>
          <div className="list">
            {liveOps.riskLimits.map((limit) => (
              <RiskLimitRow key={limit.label} limit={limit} />
            ))}
          </div>
        </div>
      </section>

      {liveOps.paperRun ? (
        <section className="layout operations-layout">
          <PaperRunPanel paperRun={liveOps.paperRun} />
        </section>
      ) : null}

      {liveOps.paperCycles && liveOps.paperCycles.length > 0 ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>Paper Decisions</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Action</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {liveOps.paperCycles.slice(0, 10).map((cycle) => (
                <tr key={cycle.id}>
                  <td>{new Date(cycle.timestamp).toLocaleTimeString()}</td>
                  <td>{cycle.symbol}</td>
                  <td>{cycle.action}</td>
                  <td>{cycle.status}</td>
                  <td>{cycle.skippedReason ?? cycle.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="layout operations-layout">
        <div className="panel">
          <div className="panel-heading">
            <h2>Positions</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Qty</th>
                <th>Avg</th>
                <th>Mark</th>
                <th>P/L</th>
                <th>Exposure</th>
              </tr>
            </thead>
            <tbody>
              {liveOps.positions.map((position) => (
                <tr key={position.symbol}>
                  <td>{position.symbol}</td>
                  <td>{position.quantity}</td>
                  <td>{currency.format(position.averageEntryPrice)}</td>
                  <td>{currency.format(position.markPrice)}</td>
                  <td>{currency.format(position.unrealizedPnl)}</td>
                  <td>{currency.format(position.exposure)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Order Blotter</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {liveOps.orders.map((order) => (
                <tr key={order.id}>
                  <td>{new Date(order.timestamp).toLocaleTimeString()}</td>
                  <td>{order.symbol}</td>
                  <td>{order.side}</td>
                  <td>{order.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function PaperRunPanel({ paperRun }: { paperRun: LiveOpsPaperRunSummary }): ReactElement {
  const executionCap =
    paperRun.maxExecutionsPerRun === null
      ? String(paperRun.executionCount)
      : `${paperRun.executionCount} / ${paperRun.maxExecutionsPerRun}`;
  const notionalCap =
    paperRun.maxNotionalPerRun === null
      ? currency.format(paperRun.submittedNotional)
      : `${currency.format(paperRun.submittedNotional)} / ${currency.format(paperRun.maxNotionalPerRun)}`;

  return (
    <div className="panel wide">
      <div className="panel-heading">
        <h2>Paper Run</h2>
        <StatusPill status={paperRun.skippedCount > 0 ? "warning" : "ready"} label="session" />
      </div>
      <div className="paper-run-grid">
        <RunStat label="Mode" value={paperRun.dryRun ? "Dry run" : "Submit"} />
        <RunStat label="Submitted Notional" value={notionalCap} />
        <RunStat label="Executions" value={executionCap} />
        <RunStat label="Skipped Cycles" value={String(paperRun.skippedCount)} />
      </div>
    </div>
  );
}

function RunStat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="run-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BacktestDashboard({
  equityRows,
  leader,
  report,
  totalAlerts,
  totalRiskRejections
}: {
  equityRows: Record<string, unknown>[];
  leader: DashboardRunSummary | undefined;
  report: DashboardReportViewModel;
  totalAlerts: number;
  totalRiskRejections: number;
}): ReactElement {
  return (
    <>
      <section className="summary-grid" aria-label="Report summary">
        <Metric label="Leader" value={leader?.strategyId ?? "n/a"} />
        <Metric label="Ending Equity" value={leader ? currency.format(leader.endingEquity) : "-"} />
        <Metric label="Return" value={leader ? `${percent.format(leader.totalReturnPct)}%` : "-"} />
        <Metric
          label="Max Drawdown"
          value={leader ? `${percent.format(leader.maxDrawdownPct)}%` : "-"}
        />
        <Metric label="Alerts" value={String(totalAlerts)} />
        <Metric label="Risk Rejections" value={String(totalRiskRejections)} />
      </section>

      <section className="layout">
        <div className="panel wide">
          <div className="panel-heading">
            <h2>Equity Curve</h2>
          </div>
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equityRows} margin={{ top: 12, right: 20, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="#d9dee7" strokeDasharray="3 3" />
                <XAxis dataKey="label" minTickGap={24} tickLine={false} />
                <YAxis tickFormatter={(value) => currency.format(Number(value))} tickLine={false} />
                <Tooltip formatter={(value) => currency.format(Number(value))} />
                {report.equitySeries.map((series, index) => (
                  <Line
                    key={series.strategyId}
                    type="monotone"
                    dataKey={series.strategyId}
                    stroke={index === 0 ? "#2563eb" : "#0f766e"}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Rankings</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Strategy</th>
                <th>Score</th>
                <th>Return</th>
              </tr>
            </thead>
            <tbody>
              {report.rankings.map((ranking) => (
                <tr key={ranking.strategyId}>
                  <td>{ranking.rank}</td>
                  <td>{ranking.strategyId}</td>
                  <td>{ranking.score}</td>
                  <td>{percent.format(ranking.totalReturnPct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="layout">
        <div className="panel">
          <div className="panel-heading">
            <h2>Runs</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Orders</th>
                <th>Fills</th>
                <th>Fees</th>
                <th>Alerts</th>
              </tr>
            </thead>
            <tbody>
              {report.runs.map((run) => (
                <RunRow key={run.strategyId} run={run} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Alerts</h2>
          </div>
          <div className="list">
            {report.alerts.slice(0, 6).map((alert) => (
              <article key={alert.id} className="alert-row">
                <span className="severity">{alert.severity}</span>
                <div>
                  <strong>{alert.type}</strong>
                  <p>{alert.message}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Decision Traces</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Strategy</th>
              <th>Action</th>
              <th>Risk</th>
              <th>Order</th>
              <th>Equity</th>
            </tr>
          </thead>
          <tbody>
            {report.decisionTraces.slice(0, 10).map((trace) => (
              <tr key={trace.id}>
                <td>{new Date(trace.timestamp).toLocaleDateString()}</td>
                <td>{trace.strategyId}</td>
                <td>{trace.action}</td>
                <td>
                  {trace.riskApproved === undefined ? "-" : trace.riskApproved ? "yes" : "no"}
                </td>
                <td>{trace.orderStatus ?? "-"}</td>
                <td>{currency.format(trace.equity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RiskLimitRow({ limit }: { limit: LiveOpsRiskLimit }): ReactElement {
  const usedLabel =
    limit.unit === "currency" ? currency.format(limit.used) : `${percent.format(limit.used)}%`;
  const limitLabel =
    limit.unit === "currency" ? currency.format(limit.limit) : `${percent.format(limit.limit)}%`;
  const width = limit.limit > 0 ? Math.min(100, (limit.used / limit.limit) * 100) : 0;

  return (
    <article className="risk-row">
      <div>
        <strong>{limit.label}</strong>
        <span>
          {usedLabel} / {limitLabel}
        </span>
      </div>
      <StatusPill status={limit.status} label={limit.status} />
      <div className="limit-track">
        <div style={{ width: `${width}%` }} />
      </div>
    </article>
  );
}

function StatusPill({
  status,
  label
}: {
  status: LiveOpsReadinessStatus;
  label: string;
}): ReactElement {
  return <span className={`status-pill ${status}`}>{label}</span>;
}

function RunRow({ run }: { run: DashboardRunSummary }): ReactElement {
  return (
    <tr>
      <td>{run.strategyId}</td>
      <td>{run.orderCount}</td>
      <td>{run.fillCount}</td>
      <td>{currency.format(run.totalFees)}</td>
      <td>{run.alertCount}</td>
    </tr>
  );
}

function mergeEquitySeries(report: DashboardReportViewModel): Record<string, unknown>[] {
  const rows = new Map<string, Record<string, unknown>>();

  for (const series of report.equitySeries) {
    for (const point of series.points) {
      const label = new Date(point.timestamp).toLocaleDateString();
      const row = rows.get(point.timestamp) ?? { timestamp: point.timestamp, label };
      row[series.strategyId] = point.equity;
      rows.set(point.timestamp, row);
    }
  }

  return [...rows.values()].sort((left, right) =>
    String(left.timestamp).localeCompare(String(right.timestamp))
  );
}
