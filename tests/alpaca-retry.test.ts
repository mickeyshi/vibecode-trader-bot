import { describe, expect, it } from "vitest";
import {
  AlpacaCircuitBreaker,
  isRetryableStatus,
  requestWithAlpacaRetry
} from "../src/feeds/alpaca-retry.js";

describe("Alpaca retry helper", () => {
  it("opens after exhausted provider failures and resets after cooldown", async () => {
    let now = 1_000;
    const breaker = new AlpacaCircuitBreaker(2, 500, () => now);
    const config = { maxAttempts: 1, initialDelayMs: 0, circuitBreaker: breaker };

    await requestWithAlpacaRetry(async () => response(503), config);
    await requestWithAlpacaRetry(async () => response(503), config);
    await expect(requestWithAlpacaRetry(async () => response(503), config)).rejects.toThrow(
      "circuit breaker is open"
    );
    now += 501;
    await expect(requestWithAlpacaRetry(async () => response(200), config)).resolves.toMatchObject({
      attemptCount: 1
    });
  });

  it("retries transient network failures", async () => {
    let attempts = 0;
    const result = await requestWithAlpacaRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("socket reset");
        return response(200);
      },
      { maxAttempts: 2, initialDelayMs: 0 }
    );

    expect(result.attemptCount).toBe(2);
  });

  it("retries retryable statuses with bounded exponential delays", async () => {
    const delays: number[] = [];
    let attempt = 0;

    const result = await requestWithAlpacaRetry(
      async () => {
        attempt += 1;
        return response(attempt === 3 ? 200 : 429);
      },
      {
        initialDelayMs: 10,
        maxDelayMs: 15,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        }
      }
    );

    expect(result).toMatchObject({
      body: '{"ok":true}',
      attemptCount: 3
    });
    expect(delays).toEqual([10, 15]);
  });

  it("does not retry non-retryable statuses", async () => {
    let attempt = 0;
    const result = await requestWithAlpacaRetry(async () => {
      attempt += 1;
      return response(403);
    });

    expect(attempt).toBe(1);
    expect(result).toMatchObject({
      body: '{"ok":false}',
      attemptCount: 1
    });
  });

  it("classifies rate limits and server errors as retryable", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(403)).toBe(false);
  });
});

function response(
  status: number
): Awaited<ReturnType<Parameters<typeof requestWithAlpacaRetry>[0]>> {
  return {
    ok: status >= 200 && status <= 299,
    status,
    statusText: status === 429 ? "Too Many Requests" : status === 403 ? "Forbidden" : "OK",
    async text() {
      return JSON.stringify({ ok: status >= 200 && status <= 299 });
    }
  };
}
