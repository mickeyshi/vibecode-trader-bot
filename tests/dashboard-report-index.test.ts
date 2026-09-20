import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildDashboardReportIndex,
  loadIndexedDashboardReport
} from "../src/dashboard/report-index.js";

describe("dashboard report index", () => {
  it("indexes only valid reports and loads them through opaque ids", async () => {
    const root = "reports/report-index-test";
    await mkdir(root, { recursive: true });
    await writeFile(`${root}/valid.json`, JSON.stringify(makeReport()), "utf8");
    await writeFile(`${root}/operations.json`, JSON.stringify({ mode: "paper" }), "utf8");

    const index = await buildDashboardReportIndex(root);

    expect(index.reports).toHaveLength(1);
    expect(index.reports[0]).toMatchObject({
      label: "valid",
      relativePath: "valid.json",
      strategies: ["momentum"]
    });
    expect(index.reports[0]?.id).toMatch(/^[a-f0-9]{16}$/);
    await expect(loadIndexedDashboardReport(index.reports[0]!.id, root)).resolves.toMatchObject({
      kind: "single",
      reportCount: 1
    });
    await expect(loadIndexedDashboardReport("0000000000000000", root)).resolves.toBeUndefined();
  });
});

function makeReport(): Record<string, unknown> {
  return {
    strategyId: "momentum",
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-01-02T00:00:00.000Z",
    endingEquity: 10_010,
    totalReturnPct: 0.1,
    maxDrawdownPct: 0.05,
    orders: [],
    fills: [],
    trades: [],
    riskRejections: [],
    equityCurve: [
      { timestamp: "2026-01-01T00:00:00.000Z", equity: 10_000 },
      { timestamp: "2026-01-02T00:00:00.000Z", equity: 10_010 }
    ],
    metrics: {
      netProfit: 10,
      totalFees: 0,
      closedTradeCount: 0
    },
    observabilityMetrics: [],
    decisionTraces: [],
    logs: [],
    alerts: [],
    dataQualityWarnings: [],
    assumptions: []
  };
}
