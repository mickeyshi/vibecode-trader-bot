export interface AlpacaHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

export interface AlpacaRetryConfig {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  circuitBreaker?: AlpacaCircuitBreaker;
}

export class AlpacaCircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | undefined;

  constructor(
    private readonly failureThreshold = 5,
    private readonly resetAfterMs = 60_000,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isInteger(failureThreshold) || failureThreshold <= 0) {
      throw new Error("Circuit breaker failureThreshold must be a positive integer.");
    }
    if (!Number.isFinite(resetAfterMs) || resetAfterMs <= 0) {
      throw new Error("Circuit breaker resetAfterMs must be positive.");
    }
  }

  beforeRequest(): void {
    if (this.openedAt === undefined) return;
    if (this.now() - this.openedAt >= this.resetAfterMs) {
      this.openedAt = undefined;
      this.consecutiveFailures = 0;
      return;
    }
    throw new Error("Alpaca provider circuit breaker is open.");
  }

  success(): void {
    this.consecutiveFailures = 0;
    this.openedAt = undefined;
  }

  failure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) this.openedAt = this.now();
  }
}

export interface AlpacaRequestResult<Response extends AlpacaHttpResponse> {
  response: Response;
  body: string;
  attemptCount: number;
}

export async function requestWithAlpacaRetry<Response extends AlpacaHttpResponse>(
  request: () => Promise<Response>,
  config: AlpacaRetryConfig = {}
): Promise<AlpacaRequestResult<Response>> {
  const maxAttempts = positiveInteger(config.maxAttempts ?? 3, "maxAttempts");
  const initialDelayMs = nonNegativeNumber(config.initialDelayMs ?? 250, "initialDelayMs");
  const maxDelayMs = nonNegativeNumber(config.maxDelayMs ?? 2_000, "maxDelayMs");
  const sleep = config.sleep ?? defaultSleep;
  config.circuitBreaker?.beforeRequest();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      if (attempt === maxAttempts) {
        config.circuitBreaker?.failure();
        throw error;
      }
      const delayMs = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      if (delayMs > 0) await sleep(delayMs);
      continue;
    }
    const body = await response.text();
    if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
      if (isRetryableStatus(response.status)) config.circuitBreaker?.failure();
      else config.circuitBreaker?.success();
      return {
        response,
        body,
        attemptCount: attempt
      };
    }

    const delayMs = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  throw new Error("Alpaca retry loop exited unexpectedly.");
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Alpaca retry ${label} must be a positive integer.`);
  }

  return value;
}

function nonNegativeNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Alpaca retry ${label} must be a non-negative finite number.`);
  }

  return value;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
