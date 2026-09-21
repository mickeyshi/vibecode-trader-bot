import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("paper supervisor scripts", () => {
  it("keeps the scheduled coordinator permanently bounded and dry-run only", async () => {
    const source = await readFile("scripts/run-supervised-paper-dry-run.ps1", "utf8");

    expect(source).toContain("--dry-run");
    expect(source).toContain("--iterations 1");
    expect(source).toContain("--max-order-notional 25");
    expect(source).toContain("--max-executions-per-run 1");
    expect(source).toContain("--max-notional-per-run 25");
    expect(source).not.toContain("live-trading:cycle");
    expect(source).not.toContain("live-trading:flatten");
  });

  it("schedules an independent monitor inside its heartbeat freshness window", async () => {
    const installer = await readFile("scripts/install-paper-supervisor.ps1", "utf8");
    const monitor = await readFile("scripts/run-supervised-operations-monitor.ps1", "utf8");

    expect(installer).toContain('-At "09:35"');
    expect(installer).toContain('-At "09:45"');
    expect(installer).toContain('Monday", "Tuesday", "Wednesday", "Thursday", "Friday');
    expect(installer).toContain("-MultipleInstances IgnoreNew");
    expect(monitor).toContain("--max-age-ms 900000");
  });
});
