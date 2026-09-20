import { resolve } from "node:path";
import { createPaperStateBackup, runPaperStateRestoreDrill } from "./paper-state-backup.js";

const args = process.argv.slice(2);
const now = new Date();
const sourceDatabase = readOption(args, "--state") ?? "reports/paper-trading.sqlite";
const historyDir = readOption(args, "--history-dir") ?? "reports/live-ops-history";
const backupDir =
  readOption(args, "--backup-dir") ?? `reports/backups/${now.toISOString().replaceAll(":", "-")}`;

const manifest = await createPaperStateBackup({ sourceDatabase, historyDir, backupDir, now });
const drill = await runPaperStateRestoreDrill(backupDir);
console.log(
  JSON.stringify(
    {
      backupDir: resolve(backupDir),
      createdAt: manifest.createdAt,
      ...drill
    },
    null,
    2
  )
);

function readOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}
