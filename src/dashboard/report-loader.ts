import { readFile } from "node:fs/promises";
import {
  buildDashboardReportViewModel,
  type DashboardReportViewModel
} from "./report-view-model.js";

export async function loadDashboardReport(reportPath: string): Promise<DashboardReportViewModel> {
  const parsed = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  return buildDashboardReportViewModel(parsed, reportPath);
}
