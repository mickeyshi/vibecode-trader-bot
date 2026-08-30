import { readFile } from "node:fs/promises";
import type { LiveOpsDashboardViewModel } from "./live-ops-view-model.js";

export interface BreakEvenAuditDay {
  date: string;
  startingEquity: number;
  targetEquity: number;
  endingEquity: number;
  feesPaid: number;
  netAfterFees: number;
  remainingToBreakEven: number;
  met: boolean;
}

export interface BreakEvenAuditSummary {
  dayCount: number;
  metCount: number;
  missedCount: number;
  currentStreak: number;
  longestStreak: number;
  allDaysMet: boolean;
  days: BreakEvenAuditDay[];
}

export async function loadBreakEvenAudit(paths: string[]): Promise<BreakEvenAuditSummary> {
  const snapshots = await Promise.all(paths.map(loadSnapshot));
  return buildBreakEvenAudit(snapshots);
}

export function buildBreakEvenAudit(snapshots: LiveOpsDashboardViewModel[]): BreakEvenAuditSummary {
  const days = snapshots.map(toAuditDay).sort((left, right) => left.date.localeCompare(right.date));
  let currentStreak = 0;
  let longestStreak = 0;

  for (const day of days) {
    if (day.met) {
      currentStreak += 1;
      longestStreak = Math.max(longestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  const metCount = days.filter((day) => day.met).length;
  const missedCount = days.length - metCount;

  return {
    dayCount: days.length,
    metCount,
    missedCount,
    currentStreak,
    longestStreak,
    allDaysMet: days.length > 0 && missedCount === 0,
    days
  };
}

function toAuditDay(snapshot: LiveOpsDashboardViewModel): BreakEvenAuditDay {
  const date = snapshot.updatedAt.slice(0, 10);
  const startingEquity = finiteNumber(
    snapshot.breakEven.startingEquity,
    `${date}.breakEven.startingEquity`
  );
  const targetEquity = finiteNumber(
    snapshot.breakEven.targetEquity,
    `${date}.breakEven.targetEquity`
  );
  const endingEquity = finiteNumber(
    snapshot.breakEven.currentEquity,
    `${date}.breakEven.currentEquity`
  );
  const feesPaid = finiteNumber(
    snapshot.breakEven.feesPaidToday,
    `${date}.breakEven.feesPaidToday`
  );
  const remainingToBreakEven = Math.max(0, targetEquity - endingEquity);

  return {
    date,
    startingEquity,
    targetEquity,
    endingEquity,
    feesPaid,
    netAfterFees: endingEquity - targetEquity,
    remainingToBreakEven,
    met: remainingToBreakEven === 0
  };
}

async function loadSnapshot(path: string): Promise<LiveOpsDashboardViewModel> {
  return JSON.parse(await readFile(path, "utf8")) as LiveOpsDashboardViewModel;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}
