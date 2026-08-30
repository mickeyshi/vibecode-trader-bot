import { describe, expect, it } from "vitest";
import { AlpacaIexMarketDataClient } from "../src/feeds/alpaca-iex-market-data-client.js";
import { loadAlpacaIexMarketDataConfig } from "../src/feeds/alpaca-iex-config.js";
import { AlpacaOrderExecutor } from "../src/execution/alpaca-order-executor.js";
import { loadAlpacaTradingConfig } from "../src/execution/alpaca-trading-config.js";

const readOnlyEnabled = process.env.RUN_ALPACA_READ_ONLY_INTEGRATION === "true";
const orderLifecycleEnabled =
  process.env.RUN_ALPACA_PAPER_ORDER_LIFECYCLE === "true" &&
  process.env.PAPER_ORDER_TEST_CONFIRMED === "I_CONFIRM_PAPER_ACCOUNT_CHANGES";

describe.skipIf(!readOnlyEnabled)("Alpaca paper read-only integration", () => {
  it("reads account, positions, orders, calendar, and normalized IEX bars", async () => {
    const trading = new AlpacaOrderExecutor(loadAlpacaTradingConfig());
    const dataConfig = loadAlpacaIexMarketDataConfig();
    expect(trading.mode).toBe("paper");
    const marketData = new AlpacaIexMarketDataClient(dataConfig);
    const symbol = dataConfig.symbols[0]!;
    const [account, positions, orders, calendar, latest, history] = await Promise.all([
      trading.getAccountSnapshot(),
      trading.getOpenPositions(),
      trading.getOpenOrders(),
      trading.getMarketCalendar(new Date().toISOString().slice(0, 10)),
      marketData.getLatestBars([symbol]),
      marketData.getHistoricalBars([symbol], { limit: 5, end: new Date() })
    ]);
    expect(account.equity).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(positions)).toBe(true);
    expect(Array.isArray(orders)).toBe(true);
    expect(orders.some((order) => order.intent.strategyId.startsWith("paper-integration-"))).toBe(
      false
    );
    expect(Array.isArray(calendar)).toBe(true);
    expect(latest[0]?.symbol).toBe(symbol);
    expect(history.every((bar) => bar.symbol === symbol)).toBe(true);
  });
});

describe.skipIf(!orderLifecycleEnabled)("Alpaca paper order lifecycle integration", () => {
  it("submits, retrieves, and cancels one tiny deeply discounted paper limit order", async () => {
    const trading = new AlpacaOrderExecutor(loadAlpacaTradingConfig());
    const dataConfig = loadAlpacaIexMarketDataConfig();
    expect(trading.mode).toBe("paper");
    const symbol = process.env.PAPER_ORDER_TEST_SYMBOL ?? dataConfig.symbols[0]!;
    const latest = (await new AlpacaIexMarketDataClient(dataConfig).getLatestBars([symbol]))[0]!;
    const limitPrice = Math.max(0.01, Math.floor(latest.close * 50) / 100);
    const quantity = Math.ceil((1.01 / limitPrice) * 1_000) / 1_000;
    const result = await trading.placeOrder({
      symbol,
      side: "buy",
      type: "limit",
      quantity,
      limitPrice,
      reason: "Explicitly confirmed opt-in paper order lifecycle test.",
      strategyId: "paper-integration-test",
      idempotencyKey: `paper-integration-${Date.now()}`
    });
    expect(result.order.id).toBeTruthy();
    const lookedUp = await trading.getOrder(result.order.id);
    expect(lookedUp?.id).toBe(result.order.id);
    if (lookedUp?.status === "new" || lookedUp?.status === "accepted") {
      await expect(trading.cancelOrder(result.order.id)).resolves.toMatchObject({
        status: "cancelled"
      });
    }
  });
});
