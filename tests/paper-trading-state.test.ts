import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPaperTradingCoordinatorState,
  JsonPaperTradingStateStore,
  parsePaperTradingCoordinatorState
} from "../src/execution/paper-trading-state.js";
import type { Order } from "../src/core/types.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("paper trading state", () => {
  it("writes and reloads coordinator restart state as JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paper-trading-state-"));
    tempDirs.push(dir);
    const path = join(dir, "state.json");
    const store = new JsonPaperTradingStateStore(path);
    const state = buildPaperTradingCoordinatorState({
      startedAt: new Date("2026-06-19T14:30:00.000Z"),
      completedAt: new Date("2026-06-19T14:31:00.000Z"),
      symbols: ["SPY"],
      cycleCount: 1,
      executionCount: 1,
      skippedCount: 0,
      orders: [order("paper-1", "accepted")]
    });

    await store.save(state);

    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 1,
      runCount: 1,
      pendingOrders: [
        {
          id: "paper-1",
          symbol: "SPY",
          status: "accepted",
          filledQuantity: 0.02,
          averageFillPrice: 500.25
        }
      ]
    });
    await expect(store.load()).resolves.toEqual(state);
    await expect(readdir(dir)).resolves.toEqual(["state.json"]);
  });

  it("rejects corrupt state instead of starting from an unsafe empty state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paper-trading-state-"));
    tempDirs.push(dir);
    const path = join(dir, "state.json");
    const store = new JsonPaperTradingStateStore(path);
    await writeFile(path, '{"version":1', "utf8");

    await expect(store.load()).rejects.toThrow(SyntaxError);
  });

  it("validates state before replacing the last valid snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paper-trading-state-"));
    tempDirs.push(dir);
    const path = join(dir, "state.json");
    const store = new JsonPaperTradingStateStore(path);
    const state = buildPaperTradingCoordinatorState({
      startedAt: new Date("2026-06-19T14:30:00.000Z"),
      completedAt: new Date("2026-06-19T14:31:00.000Z"),
      symbols: ["SPY"],
      cycleCount: 1,
      executionCount: 1,
      skippedCount: 0,
      orders: [order("paper-1", "accepted")]
    });
    await store.save(state);

    await expect(
      store.save({
        ...state,
        version: 2 as 1
      })
    ).rejects.toThrow("version must be 1");
    await expect(store.load()).resolves.toEqual(state);
    await expect(readdir(dir)).resolves.toEqual(["state.json"]);
  });

  it("persists optional rolling candle history", () => {
    const state = buildPaperTradingCoordinatorState({
      startedAt: new Date("2026-06-19T14:30:00.000Z"),
      completedAt: new Date("2026-06-19T14:31:00.000Z"),
      symbols: ["SPY"],
      cycleCount: 1,
      executionCount: 0,
      skippedCount: 1,
      orders: [],
      candleHistory: [
        {
          symbol: "SPY",
          timeframe: "1m",
          openTime: new Date("2026-06-19T14:29:00.000Z"),
          closeTime: new Date("2026-06-19T14:30:00.000Z"),
          open: 499,
          high: 501,
          low: 498,
          close: 500,
          volume: 1000
        }
      ],
      lastExecutedCandles: [
        {
          symbol: "SPY",
          closeTime: "2026-06-19T14:30:00.000Z",
          orderId: "paper-1",
          side: "buy",
          strategyId: "moving-average-crossover",
          updatedAt: "2026-06-19T14:30:15.000Z"
        }
      ]
    });

    expect(state.candleHistory).toEqual([
      {
        symbol: "SPY",
        timeframe: "1m",
        openTime: "2026-06-19T14:29:00.000Z",
        closeTime: "2026-06-19T14:30:00.000Z",
        open: 499,
        high: 501,
        low: 498,
        close: 500,
        volume: 1000
      }
    ]);
    expect(state.lastExecutedCandles).toEqual([
      {
        symbol: "SPY",
        closeTime: "2026-06-19T14:30:00.000Z",
        orderId: "paper-1",
        side: "buy",
        strategyId: "moving-average-crossover",
        updatedAt: "2026-06-19T14:30:15.000Z"
      }
    ]);
    expect(parsePaperTradingCoordinatorState(state)).toEqual(state);
  });

  it("rejects malformed state versions", () => {
    expect(() =>
      parsePaperTradingCoordinatorState({
        version: 2,
        updatedAt: "2026-06-19T14:31:00.000Z",
        runCount: 1,
        lastRun: {
          startedAt: "2026-06-19T14:30:00.000Z",
          completedAt: "2026-06-19T14:31:00.000Z",
          symbols: ["SPY"],
          cycleCount: 1,
          executionCount: 1,
          skippedCount: 0
        },
        pendingOrders: []
      })
    ).toThrow("version must be 1");
  });
});

function order(id: string, status: Order["status"]): Order {
  const now = new Date("2026-06-19T14:31:00.000Z");

  return {
    id,
    intent: {
      symbol: "SPY",
      side: "buy",
      type: "market",
      quantity: 0.05,
      reason: "state test",
      strategyId: "buy-and-hold"
    },
    status,
    createdAt: now,
    updatedAt: now,
    filledQuantity: 0.02,
    averageFillPrice: 500.25
  };
}
