import type { AlertEvent, ObservabilitySink } from "./interfaces.js";

export type WebhookFetch = (
  input: string,
  init: { method: "POST"; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; statusText: string; text(): Promise<string> }>;

export class WebhookObservabilitySink implements ObservabilitySink {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: WebhookFetch = fetch
  ) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      throw new Error("Alert webhook must use HTTPS except for local testing.");
    }
  }
  log(): void {}
  metric(): void {}
  decisionTrace(): void {}
  async alert(alert: AlertEvent): Promise<void> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "trading-bot-alert", alert })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Alert webhook failed with ${response.status} ${response.statusText}: ${body}`
      );
    }
  }
}
