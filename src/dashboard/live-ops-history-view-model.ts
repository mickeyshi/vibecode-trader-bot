import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LiveOpsReadinessStatus } from "./live-ops-view-model.js";

export interface LiveOpsHistoryEntry {
  timestamp: string;
  status: LiveOpsReadinessStatus;
  executable: boolean;
  equity: number;
  dayPnl: number;
  grossExposure: number;
  positionCount: number;
  orderCount: number;
  decisionCount: number;
  dryRun?: boolean;
  executionCount?: number;
}

export interface LiveOpsHistoryViewModel {
  entries: LiveOpsHistoryEntry[];
  totalAvailable: number;
  invalidFileCount: number;
}

export async function buildLiveOpsHistoryViewModel(
  historyDir: string,
  limit = 100
): Promise<LiveOpsHistoryViewModel> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Live operations history limit must be an integer from 1 through 500.");
  }
  const files = await readdir(historyDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  });
  const candidates = files
    .filter(
      (entry) =>
        entry.isFile() &&
        /^\d{4}-\d{2}-\d{2}(?:T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z)?\.json$/.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const entries: LiveOpsHistoryEntry[] = [];
  let invalidFileCount = 0;
  for (const name of candidates) {
    try {
      const entry = normalizeHistoryEntry(
        JSON.parse(await readFile(join(historyDir, name), "utf8"))
      );
      if (entry) entries.push(entry);
      else invalidFileCount += 1;
    } catch {
      invalidFileCount += 1;
    }
  }

  return {
    entries: entries.slice(0, limit).reverse(),
    totalAvailable: entries.length,
    invalidFileCount
  };
}

function normalizeHistoryEntry(value: unknown): LiveOpsHistoryEntry | undefined {
  if (!isRecord(value) || !isRecord(value.account)) return undefined;
  const timestamp = string(value.updatedAt);
  const status = value.headlineStatus;
  const equity = finiteNumber(value.account.equity);
  const realized = finiteNumber(value.account.dayRealizedPnl);
  const unrealized = finiteNumber(value.account.dayUnrealizedPnl);
  const grossExposure = finiteNumber(value.account.grossExposure);
  if (
    !timestamp ||
    Number.isNaN(new Date(timestamp).getTime()) ||
    !isReadinessStatus(status) ||
    typeof value.executable !== "boolean" ||
    equity === undefined ||
    realized === undefined ||
    unrealized === undefined ||
    grossExposure === undefined
  ) {
    return undefined;
  }
  const paperRun = isRecord(value.paperRun) ? value.paperRun : undefined;
  const dryRun = typeof paperRun?.dryRun === "boolean" ? paperRun.dryRun : undefined;
  const executionCount = optionalNonNegativeInteger(paperRun?.executionCount);
  return {
    timestamp: new Date(timestamp).toISOString(),
    status,
    executable: value.executable,
    equity,
    dayPnl: realized + unrealized,
    grossExposure,
    positionCount: arrayLength(value.positions),
    orderCount: arrayLength(value.orders),
    decisionCount: arrayLength(value.paperCycles),
    ...(dryRun === undefined ? {} : { dryRun }),
    ...(executionCount === undefined ? {} : { executionCount })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function isReadinessStatus(value: unknown): value is LiveOpsReadinessStatus {
  return value === "ready" || value === "warning" || value === "blocked";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
