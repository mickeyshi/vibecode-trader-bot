import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildBreakEvenAudit, type BreakEvenAuditSummary } from "./break-even-audit.js";
import type { LiveOpsDashboardViewModel } from "./live-ops-view-model.js";

export interface LiveOpsHistoryWriteResult {
  latestSnapshot: LiveOpsDashboardViewModel;
  audit: BreakEvenAuditSummary;
  historyPath: string;
  latestPath: string;
}

export async function writeLiveOpsHistorySnapshot(
  snapshot: LiveOpsDashboardViewModel,
  options: {
    historyDir: string;
    latestPath: string;
  }
): Promise<LiveOpsHistoryWriteResult> {
  await mkdir(options.historyDir, { recursive: true });
  await mkdirParent(options.latestPath);

  const timestamp = snapshot.updatedAt.replaceAll(":", "-");
  const historyPath = join(options.historyDir, `${timestamp}.json`);
  await writeFile(historyPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const historicalSnapshots = await loadLiveOpsHistory(options.historyDir);
  const audit = buildBreakEvenAudit(latestSnapshotPerDay(historicalSnapshots));
  const latestSnapshot = {
    ...snapshot,
    breakEvenAudit: {
      dayCount: audit.dayCount,
      metCount: audit.metCount,
      missedCount: audit.missedCount,
      currentStreak: audit.currentStreak,
      longestStreak: audit.longestStreak,
      allDaysMet: audit.allDaysMet
    }
  };

  await writeFile(options.latestPath, `${JSON.stringify(latestSnapshot, null, 2)}\n`, "utf8");
  await writeFile(
    join(options.historyDir, "break-even-audit.json"),
    `${JSON.stringify(audit, null, 2)}\n`,
    "utf8"
  );

  return {
    latestSnapshot,
    audit,
    historyPath,
    latestPath: options.latestPath
  };
}

export async function loadLiveOpsHistory(historyDir: string): Promise<LiveOpsDashboardViewModel[]> {
  const entries = await readdir(historyDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  });
  const snapshotPaths = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^\d{4}-\d{2}-\d{2}(?:T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z)?\.json$/.test(entry.name)
    )
    .map((entry) => join(historyDir, entry.name))
    .sort();

  return Promise.all(
    snapshotPaths.map(
      async (path) => JSON.parse(await readFile(path, "utf8")) as LiveOpsDashboardViewModel
    )
  );
}

function latestSnapshotPerDay(snapshots: LiveOpsDashboardViewModel[]): LiveOpsDashboardViewModel[] {
  const byDay = new Map<string, LiveOpsDashboardViewModel>();
  for (const snapshot of snapshots) {
    const day = snapshot.updatedAt.slice(0, 10);
    const existing = byDay.get(day);
    if (!existing || snapshot.updatedAt > existing.updatedAt) byDay.set(day, snapshot);
  }
  return [...byDay.values()].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function mkdirParent(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== ".") {
    await mkdir(parent, { recursive: true });
  }
}
