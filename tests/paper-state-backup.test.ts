import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OrderIntent } from "../src/core/types.js";
import {
  createPaperStateBackup,
  runPaperStateRestoreDrill
} from "../src/execution/paper-state-backup.js";
import { SqlitePaperTradingStore } from "../src/execution/sqlite-paper-trading-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("paper state backup and restore drill", () => {
  it("backs up WAL state and retained history into a verified self-contained set", async () => {
    const root = await temporaryDirectory();
    const statePath = join(root, "paper.sqlite");
    const historyDir = join(root, "history");
    const backupDir = join(root, "backup");
    const store = new SqlitePaperTradingStore(statePath);
    await store.save(state());
    await store.prepare("prepared-1", intent(), new Date("2026-09-20T20:00:00Z"));
    await mkdir(historyDir);
    await writeFile(join(historyDir, "2026-09-20.json"), '{"headlineStatus":"ready"}');

    const manifest = await createPaperStateBackup({
      sourceDatabase: statePath,
      historyDir,
      backupDir,
      now: new Date("2026-09-20T20:01:00Z")
    });
    store.close();
    const result = await runPaperStateRestoreDrill(backupDir);

    expect(manifest.sourceDatabaseName).toBe("paper.sqlite");
    expect(manifest.files.map((file) => file.path)).toEqual([
      "live-ops-history/2026-09-20.json",
      "paper-trading.sqlite"
    ]);
    expect(result).toEqual({
      passed: true,
      fileCount: 2,
      historyFileCount: 1,
      integrity: "ok",
      coordinatorStatePresent: true,
      unresolvedSubmissionCount: 1
    });
  });

  it("refuses backup while a coordinator lease is active", async () => {
    const root = await temporaryDirectory();
    const statePath = join(root, "paper.sqlite");
    const store = new SqlitePaperTradingStore(statePath);
    const now = new Date("2026-09-20T20:00:00Z");
    expect(store.acquireLease("coordinator", "owner", now, 60_000)).toBe(true);

    await expect(
      createPaperStateBackup({
        sourceDatabase: statePath,
        historyDir: join(root, "history"),
        backupDir: join(root, "backup"),
        now
      })
    ).rejects.toThrow("lease coordinator is active");
    store.close();
  });

  it("detects a changed backup file before restore", async () => {
    const root = await temporaryDirectory();
    const statePath = join(root, "paper.sqlite");
    const backupDir = join(root, "backup");
    const store = new SqlitePaperTradingStore(statePath);
    await store.save(state());
    store.close();
    await createPaperStateBackup({
      sourceDatabase: statePath,
      historyDir: join(root, "missing-history"),
      backupDir,
      now: new Date("2026-09-20T20:00:00Z")
    });
    await writeFile(join(backupDir, "paper-trading.sqlite"), "tampered");

    await expect(runPaperStateRestoreDrill(backupDir)).rejects.toThrow("integrity check failed");
    expect(JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8"))).toMatchObject({
      version: 1
    });
  });
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "paper-backup-"));
  temporaryDirectories.push(root);
  return root;
}

function intent(): OrderIntent {
  return {
    symbol: "SPY",
    side: "buy",
    type: "market",
    quantity: 0.01,
    reason: "backup test",
    strategyId: "buy-and-hold",
    idempotencyKey: "prepared-1"
  };
}

function state() {
  return {
    version: 1 as const,
    updatedAt: "2026-09-20T20:00:00.000Z",
    runCount: 1,
    lastRun: {
      startedAt: "2026-09-20T19:59:00.000Z",
      completedAt: "2026-09-20T20:00:00.000Z",
      symbols: ["SPY"],
      cycleCount: 1,
      executionCount: 0,
      skippedCount: 0
    },
    pendingOrders: []
  };
}
