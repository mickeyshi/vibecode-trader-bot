import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export interface OperationsHeartbeat {
  version: 1;
  service: string;
  status: "starting" | "running" | "completed" | "failed";
  timestamp: string;
  ownerId: string;
  detail?: string;
}

export class FileHeartbeatSink {
  constructor(private readonly path: string) {}

  async write(heartbeat: OperationsHeartbeat): Promise<void> {
    const validated = parseOperationsHeartbeat(heartbeat);
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, this.path);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export function parseOperationsHeartbeat(raw: unknown): OperationsHeartbeat {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Heartbeat must be an object.");
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) throw new Error("Heartbeat version must be 1.");
  if (typeof value.service !== "string" || !value.service)
    throw new Error("Heartbeat service is required.");
  if (!["starting", "running", "completed", "failed"].includes(String(value.status)))
    throw new Error("Heartbeat status is invalid.");
  if (typeof value.timestamp !== "string" || Number.isNaN(new Date(value.timestamp).getTime()))
    throw new Error("Heartbeat timestamp is invalid.");
  if (typeof value.ownerId !== "string" || !value.ownerId)
    throw new Error("Heartbeat ownerId is required.");
  return value as unknown as OperationsHeartbeat;
}

export function heartbeatIsStale(
  heartbeat: OperationsHeartbeat,
  now: Date,
  maxAgeMs: number
): boolean {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0)
    throw new Error("Heartbeat maxAgeMs must be non-negative.");
  return now.getTime() - new Date(heartbeat.timestamp).getTime() > maxAgeMs;
}
