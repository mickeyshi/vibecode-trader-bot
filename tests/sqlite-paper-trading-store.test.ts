import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OrderIntent } from "../src/core/types.js";
import { SqlitePaperTradingStore } from "../src/execution/sqlite-paper-trading-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("SqlitePaperTradingStore", () => {
  it("transactionally persists validated coordinator state", async () => {
    const { store } = await makeStore();
    await store.save(state());
    await expect(store.load()).resolves.toEqual(state());
    store.close();
  });

  it("durably records prepared submissions before broker confirmation", async () => {
    const { store } = await makeStore();
    const intent = makeIntent();
    const preparedAt = new Date("2026-06-19T14:30:00.000Z");
    await store.prepare("bot-test-1", intent, preparedAt);

    await expect(store.unresolved()).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: "bot-test-1",
        intent,
        status: "prepared",
        preparedAt: preparedAt.toISOString()
      })
    ]);

    await store.confirm(
      "bot-test-1",
      {
        id: "broker-1",
        intent,
        status: "accepted",
        createdAt: preparedAt,
        updatedAt: preparedAt
      },
      preparedAt
    );
    await expect(store.unresolved()).resolves.toEqual([]);
    store.close();
  });

  it("enforces a renewable single-owner lease and permits takeover after expiry", async () => {
    const { path, store } = await makeStore();
    const second = new SqlitePaperTradingStore(path);
    const now = new Date("2026-06-19T14:30:00.000Z");

    expect(store.acquireLease("coordinator", "owner-a", now, 60_000)).toBe(true);
    expect(second.acquireLease("coordinator", "owner-b", now, 60_000)).toBe(false);
    expect(
      second.acquireLease("coordinator", "owner-b", new Date(now.getTime() + 60_001), 60_000)
    ).toBe(true);
    second.releaseLease("coordinator", "owner-b");
    second.close();
    store.close();
  });
});

async function makeStore() {
  const directory = await mkdtemp(join(tmpdir(), "paper-sqlite-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "state.sqlite");
  return { path, store: new SqlitePaperTradingStore(path) };
}

function makeIntent(): OrderIntent {
  return {
    symbol: "SPY",
    side: "buy",
    type: "market",
    quantity: 0.05,
    reason: "test",
    strategyId: "buy-and-hold",
    idempotencyKey: "bot-test-1"
  };
}

function state() {
  return {
    version: 1 as const,
    updatedAt: "2026-06-19T14:31:00.000Z",
    runCount: 1,
    lastRun: {
      startedAt: "2026-06-19T14:30:00.000Z",
      completedAt: "2026-06-19T14:31:00.000Z",
      symbols: ["SPY"],
      cycleCount: 1,
      executionCount: 0,
      skippedCount: 1
    },
    pendingOrders: []
  };
}
