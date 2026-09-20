import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

export interface DeploymentPreflightCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface DeploymentPreflightResult {
  passed: boolean;
  checks: DeploymentPreflightCheck[];
}

export async function runPaperDeploymentPreflight(
  environment: NodeJS.ProcessEnv = process.env
): Promise<DeploymentPreflightResult> {
  const staticRoot = resolve(environment.DASHBOARD_STATIC_ROOT ?? "dist-dashboard");
  const reportsRoot = resolve(environment.DASHBOARD_REPORTS_ROOT ?? "reports");
  const checks: DeploymentPreflightCheck[] = [
    check("paper-mode", environment.ALPACA_TRADING_MODE === "paper", "Trading mode is paper."),
    check(
      "paper-endpoint",
      isPaperEndpoint(environment.ALPACA_TRADING_BASE_URL),
      "Alpaca trading endpoint is the HTTPS paper endpoint."
    ),
    check(
      "live-disabled",
      environment.LIVE_TRADING_ENABLED === "false" &&
        environment.LIVE_OPERATOR_CONFIRMED === "false",
      "Live trading and live operator confirmation are disabled."
    ),
    check("kill-switch", environment.LIVE_KILL_SWITCH_ARMED === "true", "Kill switch is armed."),
    check(
      "trading-credentials",
      present(environment.ALPACA_TRADING_API_KEY_ID) &&
        present(environment.ALPACA_TRADING_API_SECRET_KEY),
      "Trading credential variables are present; values were not inspected or printed."
    ),
    check(
      "data-credentials",
      present(environment.ALPACA_DATA_API_KEY_ID) &&
        present(environment.ALPACA_DATA_API_SECRET_KEY),
      "Market-data credential variables are present; values were not inspected or printed."
    ),
    await pathCheck(
      "dashboard-build",
      resolve(staticRoot, "index.html"),
      constants.R_OK,
      "Built dashboard index is readable."
    ),
    await pathCheck(
      "persistent-reports",
      reportsRoot,
      constants.R_OK | constants.W_OK,
      "Persistent reports directory is readable and writable."
    )
  ];
  return { passed: checks.every((item) => item.passed), checks };
}

function check(id: string, passed: boolean, successDetail: string): DeploymentPreflightCheck {
  return {
    id,
    passed,
    detail: passed ? successDetail : `${id} requirement is not satisfied.`
  };
}

async function pathCheck(
  id: string,
  path: string,
  mode: number,
  successDetail: string
): Promise<DeploymentPreflightCheck> {
  try {
    await access(path, mode);
    return check(id, true, successDetail);
  } catch {
    return check(id, false, successDetail);
  }
}

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function isPaperEndpoint(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "paper-api.alpaca.markets";
  } catch {
    return false;
  }
}
