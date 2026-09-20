import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type {
  LiveOpsDashboardViewModel,
  LiveOpsPaperRunSummary,
  LiveOpsReadinessStatus,
  LiveOpsRiskLimit
} from "../../live-ops-view-model.js";
import type { LiveOpsHistoryViewModel } from "../../live-ops-history-view-model.js";
import type { DashboardReportIndexEntry } from "../../report-index.js";
import type { DashboardReportViewModel, DashboardRunSummary } from "../../report-view-model.js";
import {
  buildEtfResearchViewModel,
  type EtfResearchViewModel
} from "../../etf-research-view-model.js";
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
  const [liveOpsSource, setLiveOpsSource] = useState<"sample" | "snapshot">("sample");
  const [online, setOnline] = useState(navigator.onLine);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>();
  const [operationsHistory, setOperationsHistory] = useState<LiveOpsHistoryViewModel>();
  const [report, setReport] = useState<DashboardReportViewModel>(sampleDashboardReport);
  const [reportEntries, setReportEntries] = useState<DashboardReportIndexEntry[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("sample");
  const [reportLoading, setReportLoading] = useState(false);
  const [research, setResearch] = useState<EtfResearchViewModel>();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [snapshotResponse, historyResponse] = await Promise.all([
        fetch("/live-ops-snapshot.json", { cache: "no-store" }),
        fetch("/api/operations/history", { cache: "no-store" })
      ]);
      if (snapshotResponse.ok) {
        setLiveOps((await snapshotResponse.json()) as LiveOpsDashboardViewModel);
        setLiveOpsSource("snapshot");
        setLastRefresh(new Date());
      }
      if (historyResponse.ok) {
        setOperationsHistory((await historyResponse.json()) as LiveOpsHistoryViewModel);
      }
    } catch {
      // The last snapshot remains visible when the mobile client temporarily loses connectivity.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [refresh]);

  useEffect(() => {
    fetch("/api/backtests", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((index: { reports?: DashboardReportIndexEntry[] } | undefined) => {
        if (index?.reports) setReportEntries(index.reports);
      })
      .catch(() => {
        // Bundled sample research remains available when the local report API is unavailable.
      });
  }, []);

  useEffect(() => {
    fetch("/api/research/etf-momentum", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((value: unknown) => {
        if (value !== undefined) setResearch(buildEtfResearchViewModel(value));
      })
      .catch(() => {
        // The research view explains how to generate the artifact when unavailable.
      });
  }, []);

  const selectReport = useCallback(async (id: string) => {
    setSelectedReportId(id);
    if (id === "sample") {
      setReport(sampleDashboardReport);
      return;
    }
    setReportLoading(true);
    try {
      const response = await fetch(`/api/backtests/${id}`, { cache: "no-store" });
      if (response.ok) setReport((await response.json()) as DashboardReportViewModel);
    } finally {
      setReportLoading(false);
    }
  }, []);

  return (
    <Dashboard
      liveOps={liveOps}
      liveOpsSource={liveOpsSource}
      report={report}
      reportEntries={reportEntries}
      selectedReportId={selectedReportId}
      reportLoading={reportLoading}
      research={research}
      operationsHistory={operationsHistory}
      selectReport={selectReport}
      online={online}
      refreshing={refreshing}
      lastRefresh={lastRefresh}
      refresh={refresh}
    />
  );
}

function Dashboard({
  liveOps,
  liveOpsSource,
  report,
  reportEntries,
  selectedReportId,
  reportLoading,
  research,
  operationsHistory,
  selectReport,
  online,
  refreshing,
  lastRefresh,
  refresh
}: {
  liveOps: LiveOpsDashboardViewModel;
  liveOpsSource: "sample" | "snapshot";
  report: DashboardReportViewModel;
  reportEntries: DashboardReportIndexEntry[];
  selectedReportId: string;
  reportLoading: boolean;
  research: EtfResearchViewModel | undefined;
  operationsHistory: LiveOpsHistoryViewModel | undefined;
  selectReport: (id: string) => Promise<void>;
  online: boolean;
  refreshing: boolean;
  lastRefresh: Date | undefined;
  refresh: () => Promise<void>;
}): ReactElement {
  const [activeView, setActiveView] = useState<"operations" | "backtests" | "research">(
    "operations"
  );
  const leader = report.runs[0];
  const equityRows = mergeEquitySeries(report);
  const totalAlerts = report.runs.reduce((sum, run) => sum + run.alertCount, 0);
  const totalRiskRejections = report.runs.reduce((sum, run) => sum + run.riskRejectionCount, 0);
  const snapshotIsStale = Date.now() - new Date(liveOps.updatedAt).getTime() > 120_000;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Trading operations</p>
          <h1>Trader Ops</h1>
          <p className="mobile-subtitle">Read-only paper trading monitor</p>
        </div>
        <div className="run-meta">
          <span className={`connection ${online ? "online" : "offline"}`}>
            {online ? "ONLINE" : "OFFLINE"}
          </span>
          <StatusPill status={liveOps.headlineStatus} label={liveOps.headlineStatus} />
          <span>{liveOps.executable ? "executable" : "blocked"}</span>
          <span>{liveOps.mode}</span>
          <span>{new Date(liveOps.updatedAt).toLocaleString()}</span>
          <span className={`data-source ${liveOpsSource === "sample" ? "sample" : ""}`}>
            {liveOpsSource === "sample"
              ? "SAMPLE OPERATIONS DATA"
              : snapshotIsStale
                ? "STALE LOCAL SNAPSHOT"
                : "CURRENT LOCAL SNAPSHOT"}
          </span>
          <span className="data-source sample">SAMPLE BACKTEST DATA</span>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="sync-strip" role="status">
        <span>
          {snapshotIsStale ? "Snapshot needs attention" : "Snapshot within freshness window"}
        </span>
        <span>
          {lastRefresh ? `Checked ${lastRefresh.toLocaleTimeString()}` : "Waiting for first sync"}
        </span>
      </div>

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
        <button
          className={activeView === "research" ? "active" : ""}
          type="button"
          onClick={() => setActiveView("research")}
        >
          Research
        </button>
      </nav>

      {activeView === "operations" ? (
        <OperationsDashboard liveOps={liveOps} history={operationsHistory} />
      ) : activeView === "backtests" ? (
        <BacktestDashboard
          equityRows={equityRows}
          leader={leader}
          report={report}
          reportEntries={reportEntries}
          selectedReportId={selectedReportId}
          reportLoading={reportLoading}
          selectReport={selectReport}
          totalAlerts={totalAlerts}
          totalRiskRejections={totalRiskRejections}
        />
      ) : (
        <ResearchDashboard research={research} />
      )}
    </main>
  );
}

function OperationsDashboard({
  liveOps,
  history
}: {
  liveOps: LiveOpsDashboardViewModel;
  history: LiveOpsHistoryViewModel | undefined;
}): ReactElement {
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

      <OperationsHistoryPanel history={history} />

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

function OperationsHistoryPanel({
  history
}: {
  history: LiveOpsHistoryViewModel | undefined;
}): ReactElement {
  if (!history || history.entries.length === 0) {
    return (
      <section className="panel history-panel">
        <div className="panel-heading">
          <h2>Run History</h2>
        </div>
        <div className="empty-state">
          <p>No retained coordinator history is available yet.</p>
        </div>
      </section>
    );
  }
  const latest = history.entries.at(-1)!;
  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <h2>Run History</h2>
        <span className="panel-note">
          {history.entries.length} of {history.totalAvailable} retained runs
        </span>
      </div>
      <div className="history-chart" aria-label="Equity across retained coordinator runs">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history.entries} margin={{ top: 12, right: 18, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={(value) => new Date(value).toLocaleDateString()}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(value) => currency.format(Number(value))}
            />
            <Tooltip
              labelFormatter={(value) => new Date(String(value)).toLocaleString()}
              formatter={(value) => [currency.format(Number(value)), "Equity"]}
            />
            <Line type="monotone" dataKey="equity" stroke="#0f766e" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="history-latest">
        <div>
          <span>Latest status</span>
          <StatusPill status={latest.status} label={latest.status} />
        </div>
        <div>
          <span>Day P/L</span>
          <strong>{currency.format(latest.dayPnl)}</strong>
        </div>
        <div>
          <span>Exposure</span>
          <strong>{currency.format(latest.grossExposure)}</strong>
        </div>
        <div>
          <span>Executions</span>
          <strong>{latest.executionCount ?? "—"}</strong>
        </div>
      </div>
      {history.invalidFileCount > 0 ? (
        <p className="history-warning">
          {history.invalidFileCount} malformed history file(s) were excluded.
        </p>
      ) : null}
    </section>
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
  reportEntries,
  selectedReportId,
  reportLoading,
  selectReport,
  totalAlerts,
  totalRiskRejections
}: {
  equityRows: Record<string, unknown>[];
  leader: DashboardRunSummary | undefined;
  report: DashboardReportViewModel;
  reportEntries: DashboardReportIndexEntry[];
  selectedReportId: string;
  reportLoading: boolean;
  selectReport: (id: string) => Promise<void>;
  totalAlerts: number;
  totalRiskRejections: number;
}): ReactElement {
  return (
    <>
      <section className="report-picker" aria-label="Backtest report selection">
        <label htmlFor="report-select">Research report</label>
        <select
          id="report-select"
          value={selectedReportId}
          disabled={reportLoading}
          onChange={(event) => void selectReport(event.target.value)}
        >
          <option value="sample">Bundled sample report</option>
          {reportEntries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label} · {entry.strategies.join(", ")}
            </option>
          ))}
        </select>
        <span>{reportLoading ? "Loading…" : `${report.reportCount} strategy run(s)`}</span>
      </section>
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

function ResearchDashboard({
  research
}: {
  research: EtfResearchViewModel | undefined;
}): ReactElement {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  if (!research) {
    return (
      <section className="panel empty-state">
        <h2>Research artifact unavailable</h2>
        <p>Run `npm run research:etf-momentum` to generate the local read-only report.</p>
      </section>
    );
  }
  const selected = research.results[scenarioIndex] ?? research.results[0];
  if (!selected)
    return <section className="panel empty-state">Research scenarios are missing.</section>;
  const result = selected.result;
  const annualRows = Object.keys(result.strategy.annualReturnsPct);
  return (
    <>
      <section className="research-banner">
        <strong>Research only · not promoted for paper execution</strong>
        <span>
          {research.dataProvenance.source} · adjustment={research.dataProvenance.adjustment} ·
          through {result.lastDate}
        </span>
      </section>
      <section className="report-picker" aria-label="Research scenario selection">
        <label htmlFor="research-scenario">Scenario</label>
        <select
          id="research-scenario"
          value={scenarioIndex}
          onChange={(event) => setScenarioIndex(Number(event.target.value))}
        >
          {research.results.map(({ configuration }, index) => (
            <option key={scenarioLabel(configuration, index)} value={index}>
              {scenarioLabel(configuration, index)}
            </option>
          ))}
        </select>
        <span>{research.results.length} validated scenarios</span>
      </section>
      <section className="summary-grid" aria-label="ETF research summary">
        <Metric
          label="Strategy Return"
          value={`${percent.format(result.strategy.totalReturnPct)}%`}
        />
        <Metric
          label="Benchmark Return"
          value={`${percent.format(result.benchmark.totalReturnPct)}%`}
        />
        <Metric
          label="Strategy Drawdown"
          value={`${percent.format(result.strategy.maxDrawdownPct)}%`}
        />
        <Metric
          label="Benchmark Drawdown"
          value={`${percent.format(result.benchmark.maxDrawdownPct)}%`}
        />
        <Metric label="Strategy Sharpe" value={percent.format(result.strategy.sharpeRatio)} />
        <Metric label="Benchmark Sharpe" value={percent.format(result.benchmark.sharpeRatio)} />
      </section>
      <section className="layout">
        <AttributionTable
          title="Symbol contribution"
          rows={result.strategy.symbolContributionPct}
        />
        <AttributionTable
          title="Regime contribution"
          rows={result.strategy.regimeContributionPct}
        />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Calendar-year return</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Year</th>
              <th>Strategy</th>
              <th>Benchmark</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            {annualRows.map((year) => {
              const strategy = result.strategy.annualReturnsPct[year] ?? 0;
              const benchmark = result.benchmark.annualReturnsPct[year] ?? 0;
              return (
                <tr key={year}>
                  <td>{year}</td>
                  <td>{percent.format(strategy)}%</td>
                  <td>{percent.format(benchmark)}%</td>
                  <td>{percent.format(strategy - benchmark)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="panel-note">{research.benchmarkDefinition.interpretation}</p>
      </section>
    </>
  );
}

function scenarioLabel(
  configuration: EtfResearchViewModel["results"][number]["configuration"],
  index: number
): string {
  if (index === 0) return "Base · 126/200 windows · 10 bps";
  if (configuration.transactionCostBps !== 10) {
    return `Cost stress · ${configuration.transactionCostBps} bps`;
  }
  if (configuration.rebalanceDelaySessions > 0) {
    return `Execution delay · ${configuration.rebalanceDelaySessions} session(s)`;
  }
  if (configuration.skipEveryNthRebalance > 0) {
    return `Missed execution · every ${configuration.skipEveryNthRebalance}rd rebalance`;
  }
  if (configuration.cashAnnualYieldPct > 0) {
    return `Cash yield · ${configuration.cashAnnualYieldPct}% annual`;
  }
  return `Parameter sensitivity · ${configuration.momentumWindow}/${configuration.trendWindow} windows`;
}

function AttributionTable({
  title,
  rows
}: {
  title: string;
  rows: Record<string, number>;
}): ReactElement {
  return (
    <div className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>Bucket</th>
            <th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(rows).map(([label, value]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{percent.format(value)} pp</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
