import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPaperDeploymentPreflight } from "../src/deployment/paper-deployment-preflight.js";

describe("paper deployment preflight", () => {
  it("passes a complete paper-only runtime without returning secret values", async () => {
    const root = await mkdtemp(join(tmpdir(), "deployment-preflight-"));
    const staticRoot = join(root, "static");
    const reportsRoot = join(root, "reports");
    await mkdir(staticRoot);
    await mkdir(reportsRoot);
    await writeFile(join(staticRoot, "index.html"), "ready");
    const secret = "must-not-appear";
    const result = await runPaperDeploymentPreflight({
      ALPACA_TRADING_MODE: "paper",
      ALPACA_TRADING_BASE_URL: "https://paper-api.alpaca.markets",
      ALPACA_TRADING_API_KEY_ID: secret,
      ALPACA_TRADING_API_SECRET_KEY: secret,
      ALPACA_DATA_API_KEY_ID: secret,
      ALPACA_DATA_API_SECRET_KEY: secret,
      LIVE_TRADING_ENABLED: "false",
      LIVE_OPERATOR_CONFIRMED: "false",
      LIVE_KILL_SWITCH_ARMED: "true",
      DASHBOARD_STATIC_ROOT: staticRoot,
      DASHBOARD_REPORTS_ROOT: reportsRoot
    });
    expect(result.passed).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("fails closed for live mode, wrong endpoint, disabled kill switch, and absent files", async () => {
    const result = await runPaperDeploymentPreflight({
      ALPACA_TRADING_MODE: "live",
      ALPACA_TRADING_BASE_URL: "https://api.alpaca.markets",
      LIVE_TRADING_ENABLED: "true",
      LIVE_OPERATOR_CONFIRMED: "true",
      LIVE_KILL_SWITCH_ARMED: "false",
      DASHBOARD_STATIC_ROOT: "missing-build",
      DASHBOARD_REPORTS_ROOT: "missing-reports"
    });
    expect(result.passed).toBe(false);
    expect(result.checks.every((check) => !check.passed)).toBe(true);
  });
});
