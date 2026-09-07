import type { LiveOpsDashboardViewModel } from "../dashboard/live-ops-view-model.js";

export interface PaperSoakCriteria {
  minimumDays: number;
  minimumExecutions: number;
  maximumRejectedCycles: number;
  maximumStaleCycles: number;
}

export interface PaperSoakAudit {
  passed: boolean;
  dayCount: number;
  executionCount: number;
  rejectedCycleCount: number;
  staleCycleCount: number;
  blockedSnapshotCount: number;
  excludedNonRunSnapshotCount: number;
  gates: Array<{ id: string; passed: boolean; detail: string }>;
  disclaimer: string;
}

export function evaluatePaperSoak(
  snapshots: LiveOpsDashboardViewModel[],
  criteria: PaperSoakCriteria
): PaperSoakAudit {
  if (!Number.isInteger(criteria.minimumDays) || criteria.minimumDays <= 0)
    throw new Error("minimumDays must be a positive integer.");
  if (!Number.isInteger(criteria.minimumExecutions) || criteria.minimumExecutions < 0)
    throw new Error("minimumExecutions must be a non-negative integer.");
  const runSnapshots = snapshots.filter((snapshot) => snapshot.paperRun !== undefined);
  const dates = new Set(runSnapshots.map((snapshot) => snapshot.updatedAt.slice(0, 10)));
  const executionCount = runSnapshots.reduce(
    (sum, snapshot) => sum + (snapshot.paperRun?.executionCount ?? 0),
    0
  );
  const cycles = runSnapshots.flatMap((snapshot) => snapshot.paperCycles ?? []);
  const rejectedCycleCount = cycles.filter((cycle) => cycle.status === "rejected").length;
  const staleCycleCount = cycles.filter((cycle) =>
    /stale/i.test(cycle.skippedReason ?? cycle.reason)
  ).length;
  const blockedSnapshotCount = runSnapshots.filter(
    (snapshot) => snapshot.headlineStatus === "blocked"
  ).length;
  const gates = [
    {
      id: "minimum-days",
      passed: dates.size >= criteria.minimumDays,
      detail: `${dates.size}/${criteria.minimumDays} distinct paper days recorded.`
    },
    {
      id: "minimum-executions",
      passed: executionCount >= criteria.minimumExecutions,
      detail: `${executionCount}/${criteria.minimumExecutions} paper executions recorded.`
    },
    {
      id: "rejected-cycles",
      passed: rejectedCycleCount <= criteria.maximumRejectedCycles,
      detail: `${rejectedCycleCount}/${criteria.maximumRejectedCycles} allowed rejected cycles.`
    },
    {
      id: "stale-cycles",
      passed: staleCycleCount <= criteria.maximumStaleCycles,
      detail: `${staleCycleCount}/${criteria.maximumStaleCycles} allowed stale-data cycles.`
    },
    {
      id: "blocked-snapshots",
      passed: blockedSnapshotCount === 0,
      detail: `${blockedSnapshotCount} blocked snapshots recorded.`
    }
  ];
  return {
    passed: gates.every((gate) => gate.passed),
    dayCount: dates.size,
    executionCount,
    rejectedCycleCount,
    staleCycleCount,
    blockedSnapshotCount,
    excludedNonRunSnapshotCount: snapshots.length - runSnapshots.length,
    gates,
    disclaimer:
      "This audit measures operational paper reliability, not profitability or live-capital readiness."
  };
}
