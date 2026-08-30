import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileHeartbeatSink,
  heartbeatIsStale,
  parseOperationsHeartbeat
} from "../src/observability/file-heartbeat.js";
import { WebhookObservabilitySink } from "../src/observability/webhook-observability-sink.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("operations supervision", () => {
  it("atomically writes a parseable heartbeat and detects staleness", async () => {
    const directory = await mkdtemp(join(tmpdir(), "heartbeat-"));
    directories.push(directory);
    const path = join(directory, "heartbeat.json");
    const heartbeat = {
      version: 1 as const,
      service: "paper-coordinator",
      status: "running" as const,
      timestamp: "2026-06-19T14:30:00.000Z",
      ownerId: "owner-1"
    };
    await new FileHeartbeatSink(path).write(heartbeat);
    const parsed = parseOperationsHeartbeat(JSON.parse(await readFile(path, "utf8")));
    expect(parsed).toEqual(heartbeat);
    expect(heartbeatIsStale(parsed, new Date("2026-06-19T14:32:01.000Z"), 120_000)).toBe(true);
  });

  it("delivers sanitized structured alerts to an HTTPS webhook", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const sink = new WebhookObservabilitySink(
      "https://alerts.example.test/hook",
      async (url, init) => {
        requests.push({ url, body: JSON.parse(init.body) });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async text() {
            return "";
          }
        };
      }
    );
    await sink.alert({
      id: "alert-1",
      timestamp: new Date("2026-06-19T14:30:00.000Z"),
      severity: "critical",
      type: "heartbeat-stale",
      message: "Coordinator heartbeat is stale."
    });
    expect(requests).toEqual([
      {
        url: "https://alerts.example.test/hook",
        body: expect.objectContaining({
          type: "trading-bot-alert",
          alert: expect.objectContaining({ type: "heartbeat-stale" })
        })
      }
    ]);
  });

  it("rejects plaintext remote webhook endpoints", () => {
    expect(() => new WebhookObservabilitySink("http://alerts.example.test/hook")).toThrow(
      "must use HTTPS"
    );
  });
});
