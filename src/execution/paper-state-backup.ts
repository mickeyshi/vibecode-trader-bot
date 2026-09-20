import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { parsePaperTradingCoordinatorState } from "./paper-trading-state.js";

export interface PaperStateBackupManifest {
  version: 1;
  createdAt: string;
  sourceDatabaseName: string;
  databaseFile: string;
  historyDirectory: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

export interface PaperStateRestoreDrillResult {
  passed: true;
  fileCount: number;
  historyFileCount: number;
  integrity: "ok";
  coordinatorStatePresent: boolean;
  unresolvedSubmissionCount: number;
}

export async function createPaperStateBackup(options: {
  sourceDatabase: string;
  historyDir: string;
  backupDir: string;
  now?: Date;
}): Promise<PaperStateBackupManifest> {
  const sourceDatabase = resolve(options.sourceDatabase);
  const backupDir = resolve(options.backupDir);
  const now = options.now ?? new Date();
  await ensureNewDirectory(backupDir);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(sourceDatabase, { readOnly: true });
    assertNoActiveLease(database, now);
    const databaseFile = "paper-trading.sqlite";
    await backup(database, join(backupDir, databaseFile));
    const historyDirectory = "live-ops-history";
    await copyHistoryFiles(options.historyDir, join(backupDir, historyDirectory));
    const files = await inventoryFiles(backupDir);
    const manifest: PaperStateBackupManifest = {
      version: 1,
      createdAt: now.toISOString(),
      sourceDatabaseName: basename(sourceDatabase),
      databaseFile,
      historyDirectory,
      files
    };
    await writeFile(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    return manifest;
  } catch (error) {
    await rm(backupDir, { recursive: true, force: true });
    throw error;
  } finally {
    database?.close();
  }
}

export async function runPaperStateRestoreDrill(
  backupDir: string
): Promise<PaperStateRestoreDrillResult> {
  const root = resolve(backupDir);
  const manifest = parseManifest(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")));
  for (const file of manifest.files) {
    const path = containedPath(root, file.path);
    const details = await stat(path);
    if (!details.isFile() || details.size !== file.bytes || (await sha256(path)) !== file.sha256) {
      throw new Error(`Backup integrity check failed for ${file.path}.`);
    }
  }

  const drillDir = await mkdtemp(join(tmpdir(), "paper-state-restore-"));
  const restoredDatabase = join(drillDir, "restored.sqlite");
  try {
    await copyFile(containedPath(root, manifest.databaseFile), restoredDatabase);
    const database = new DatabaseSync(restoredDatabase, { readOnly: true });
    try {
      const integrity = database.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      };
      if (integrity.integrity_check !== "ok")
        throw new Error("Restored SQLite integrity check failed.");
      assertRequiredTables(database);
      const stateRow = database
        .prepare("SELECT state_json FROM coordinator_state WHERE singleton=1")
        .get() as { state_json: string } | undefined;
      if (stateRow) parsePaperTradingCoordinatorState(JSON.parse(stateRow.state_json) as unknown);
      const journalRows = database
        .prepare("SELECT intent_json FROM submission_journal WHERE status='prepared'")
        .all() as Array<{ intent_json: string }>;
      for (const row of journalRows) validateIntent(JSON.parse(row.intent_json) as unknown);
      return {
        passed: true,
        fileCount: manifest.files.length,
        historyFileCount: manifest.files.filter((file) =>
          file.path.startsWith(`${manifest.historyDirectory}/`)
        ).length,
        integrity: "ok",
        coordinatorStatePresent: stateRow !== undefined,
        unresolvedSubmissionCount: journalRows.length
      };
    } finally {
      database.close();
    }
  } finally {
    await rm(drillDir, { recursive: true, force: true });
  }
}

function assertNoActiveLease(database: DatabaseSync, now: Date): void {
  const lease = database
    .prepare("SELECT lease_name FROM coordinator_lease WHERE expires_at > ? LIMIT 1")
    .get(now.toISOString()) as { lease_name: string } | undefined;
  if (lease)
    throw new Error(`Backup refused while coordinator lease ${lease.lease_name} is active.`);
}

function assertRequiredTables(database: DatabaseSync): void {
  const rows = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('coordinator_state','submission_journal','coordinator_lease')"
    )
    .all() as Array<{ name: string }>;
  if (rows.length !== 3) throw new Error("Restored database is missing required execution tables.");
}

function validateIntent(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !("symbol" in value) ||
    typeof value.symbol !== "string" ||
    !("quantity" in value) ||
    typeof value.quantity !== "number" ||
    !Number.isFinite(value.quantity) ||
    value.quantity <= 0
  ) {
    throw new Error("Restored submission journal contains an invalid intent.");
  }
}

async function ensureNewDirectory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await mkdir(path, { recursive: false });
}

async function copyHistoryFiles(sourceDir: string, destinationDir: string): Promise<void> {
  await mkdir(destinationDir);
  const entries = await readdir(sourceDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await copyFile(join(sourceDir, entry.name), join(destinationDir, entry.name));
    }
  }
}

async function inventoryFiles(root: string): Promise<PaperStateBackupManifest["files"]> {
  const files: PaperStateBackupManifest["files"] = [];
  for (const entry of await walkFiles(root)) {
    const details = await stat(entry);
    files.push({
      path: relative(root, entry).split(sep).join("/"),
      bytes: details.size,
      sha256: await sha256(entry)
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function walkFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await walkFiles(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function containedPath(root: string, relativePath: string): string {
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error("Backup manifest contains an unsafe path.");
  }
  return path;
}

function parseManifest(value: unknown): PaperStateBackupManifest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("databaseFile" in value) ||
    typeof value.databaseFile !== "string" ||
    !("historyDirectory" in value) ||
    typeof value.historyDirectory !== "string" ||
    !("files" in value) ||
    !Array.isArray(value.files)
  ) {
    throw new Error("Backup manifest is invalid.");
  }
  for (const file of value.files) {
    if (
      typeof file !== "object" ||
      file === null ||
      !("path" in file) ||
      typeof file.path !== "string" ||
      !("bytes" in file) ||
      typeof file.bytes !== "number" ||
      !("sha256" in file) ||
      typeof file.sha256 !== "string"
    ) {
      throw new Error("Backup manifest file entry is invalid.");
    }
  }
  return value as unknown as PaperStateBackupManifest;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
