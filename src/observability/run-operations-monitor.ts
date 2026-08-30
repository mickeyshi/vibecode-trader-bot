import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { heartbeatIsStale, parseOperationsHeartbeat } from "./file-heartbeat.js";
import { WebhookObservabilitySink } from "./webhook-observability-sink.js";

const args = process.argv.slice(2);
const path = readOption(args, "--heartbeat") ?? "reports/paper-trading-heartbeat.json";
const maxAgeMs = numberOption(args, "--max-age-ms", 120_000);
const webhookUrl = process.env.ALERT_WEBHOOK_URL;
const heartbeat = parseOperationsHeartbeat(JSON.parse(await readFile(path, "utf8")) as unknown);
const stale = heartbeatIsStale(heartbeat, new Date(), maxAgeMs);

if (stale && webhookUrl) {
  await new WebhookObservabilitySink(webhookUrl).alert({
    id: randomUUID(),
    timestamp: new Date(),
    severity: "critical",
    type: "heartbeat-stale",
    message: `Heartbeat for ${heartbeat.service} is stale.`,
    context: { lastHeartbeatAt: heartbeat.timestamp, status: heartbeat.status }
  });
}

console.log(JSON.stringify({ healthy: !stale, heartbeat, maxAgeMs }, null, 2));
if (stale) process.exitCode = 1;

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

function numberOption(args: string[], name: string, fallback: number): number {
  const raw = readOption(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative.`);
  return value;
}
