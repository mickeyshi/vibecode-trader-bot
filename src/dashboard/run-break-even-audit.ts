import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadBreakEvenAudit } from "./break-even-audit.js";

const cli = parseArgs(process.argv.slice(2));
const audit = await loadBreakEvenAudit(cli.snapshotPaths);
const json = JSON.stringify(audit, null, 2);

if (cli.out) {
  await mkdir(dirname(cli.out), { recursive: true });
  await writeFile(cli.out, `${json}\n`, "utf8");
}

console.log(json);

interface BreakEvenAuditCli {
  snapshotPaths: string[];
  out?: string;
}

function parseArgs(args: string[]): BreakEvenAuditCli {
  const out = readOption(args, "--out");
  const snapshotPaths = args.filter((arg, index) => {
    if (arg === "--out") return false;
    if (index > 0 && args[index - 1] === "--out") return false;
    return !arg.startsWith("--");
  });

  if (snapshotPaths.length === 0) {
    throw new Error("Provide at least one live-ops snapshot path.");
  }

  return {
    snapshotPaths,
    ...(out ? { out } : {})
  };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg === name);
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}
