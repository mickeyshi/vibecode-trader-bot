import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heartbeatIsStale, type OperationsHeartbeat } from "../observability/file-heartbeat.js";
import { SqlitePaperTradingStore } from "./sqlite-paper-trading-store.js";

const directory = await mkdtemp(join(tmpdir(), "paper-recovery-drill-"));
const path = join(directory, "state.sqlite");
const primary = new SqlitePaperTradingStore(path);
const competing = new SqlitePaperTradingStore(path);
const now = new Date("2026-09-08T14:30:00.000Z");

try {
  const firstLease = primary.acquireLease("paper-coordinator", "owner-a", now, 60_000);
  const competingLeaseBlocked = !competing.acquireLease(
    "paper-coordinator",
    "owner-b",
    now,
    60_000
  );
  const expiredLeaseRecovered = competing.acquireLease(
    "paper-coordinator",
    "owner-b",
    new Date(now.getTime() + 60_001),
    60_000
  );
  await competing.prepare(
    "drill-idempotency-key",
    {
      symbol: "DRILL",
      side: "buy",
      type: "limit",
      quantity: 1,
      limitPrice: 1,
      reason: "Local recovery drill only.",
      strategyId: "recovery-drill",
      idempotencyKey: "drill-idempotency-key"
    },
    now
  );
  const preparedSubmissionRecovered = (await competing.unresolved()).length === 1;
  const heartbeat: OperationsHeartbeat = {
    version: 1,
    service: "paper-coordinator",
    status: "running",
    timestamp: now.toISOString(),
    ownerId: "owner-a"
  };
  const staleHeartbeatDetected = heartbeatIsStale(
    heartbeat,
    new Date(now.getTime() + 120_001),
    120_000
  );
  const checks = {
    firstLease,
    competingLeaseBlocked,
    expiredLeaseRecovered,
    preparedSubmissionRecovered,
    staleHeartbeatDetected
  };
  console.log(JSON.stringify({ passed: Object.values(checks).every(Boolean), checks }, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
} finally {
  competing.close();
  primary.close();
  await rm(directory, { recursive: true, force: true });
}
