import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  buildDashboardReportViewModel,
  type DashboardReportViewModel
} from "./report-view-model.js";

export interface DashboardReportIndexEntry {
  id: string;
  label: string;
  relativePath: string;
  modifiedAt: string;
  kind: DashboardReportViewModel["kind"];
  reportCount: number;
  strategies: string[];
  start: string;
  end: string;
}

export interface DashboardReportIndex {
  generatedAt: string;
  reports: DashboardReportIndexEntry[];
}

export async function buildDashboardReportIndex(
  reportsRoot = "reports"
): Promise<DashboardReportIndex> {
  const root = resolve(reportsRoot);
  const paths = await jsonFiles(root);
  const entries: DashboardReportIndexEntry[] = [];
  for (const path of paths) {
    try {
      const viewModel = buildDashboardReportViewModel(
        JSON.parse(await readFile(path, "utf8")) as unknown
      );
      const fileStat = await stat(path);
      const relativePath = relative(root, path).split(sep).join("/");
      const starts = viewModel.runs.map((run) => run.start).sort();
      const ends = viewModel.runs.map((run) => run.end).sort();
      entries.push({
        id: reportId(relativePath),
        label: relativePath.replace(/\.json$/i, ""),
        relativePath,
        modifiedAt: fileStat.mtime.toISOString(),
        kind: viewModel.kind,
        reportCount: viewModel.reportCount,
        strategies: viewModel.runs.map((run) => run.strategyId),
        start: starts[0]!,
        end: ends.at(-1)!
      });
    } catch {
      // Operations snapshots, configs, and partial artifacts are intentionally excluded.
    }
  }
  entries.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return { generatedAt: new Date().toISOString(), reports: entries };
}

export async function loadIndexedDashboardReport(
  id: string,
  reportsRoot = "reports"
): Promise<DashboardReportViewModel | undefined> {
  const root = resolve(reportsRoot);
  const index = await buildDashboardReportIndex(root);
  const entry = index.reports.find((candidate) => candidate.id === id);
  if (!entry) return undefined;
  const path = resolve(root, entry.relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) return undefined;
  return buildDashboardReportViewModel(
    JSON.parse(await readFile(path, "utf8")),
    entry.relativePath
  );
}

function reportId(relativePath: string): string {
  return createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
}

async function jsonFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return jsonFiles(path);
      return Promise.resolve(entry.isFile() && entry.name.endsWith(".json") ? [path] : []);
    })
  );
  return nested.flat();
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
