import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Order, OrderIntent } from "../core/types.js";
import {
  parsePaperTradingCoordinatorState,
  type PaperTradingCoordinatorState,
  type PaperTradingStateStore,
  type SubmissionJournal,
  type SubmissionJournalEntry
} from "./paper-trading-state.js";

export class SqlitePaperTradingStore implements PaperTradingStateStore, SubmissionJournal {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;"
    );
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS coordinator_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS submission_journal (
        idempotency_key TEXT PRIMARY KEY,
        intent_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('prepared', 'confirmed', 'not-found')),
        prepared_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        broker_order_id TEXT,
        detail TEXT
      );
      CREATE TABLE IF NOT EXISTS coordinator_lease (
        lease_name TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.database.close();
  }

  async load(): Promise<PaperTradingCoordinatorState | undefined> {
    const row = this.database
      .prepare("SELECT state_json FROM coordinator_state WHERE singleton = 1")
      .get() as { state_json: string } | undefined;
    return row
      ? parsePaperTradingCoordinatorState(JSON.parse(row.state_json) as unknown)
      : undefined;
  }

  async save(state: PaperTradingCoordinatorState): Promise<void> {
    const validated = parsePaperTradingCoordinatorState(state);
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO coordinator_state(singleton, state_json, updated_at) VALUES(1, ?, ?)
          ON CONFLICT(singleton) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`
        )
        .run(JSON.stringify(validated), validated.updatedAt);
    });
  }

  async prepare(idempotencyKey: string, intent: OrderIntent, now: Date): Promise<void> {
    const timestamp = now.toISOString();
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO submission_journal
          (idempotency_key, intent_json, status, prepared_at, updated_at)
          VALUES (?, ?, 'prepared', ?, ?)`
        )
        .run(idempotencyKey, JSON.stringify(intent), timestamp, timestamp);
    });
  }

  async confirm(idempotencyKey: string, order: Order, now: Date): Promise<void> {
    const result = this.database
      .prepare(
        `UPDATE submission_journal SET status='confirmed', broker_order_id=?, updated_at=?, detail=NULL
        WHERE idempotency_key=? AND status='prepared'`
      )
      .run(order.id, now.toISOString(), idempotencyKey);
    if (Number(result.changes) !== 1) {
      throw new Error(`Prepared submission journal entry ${idempotencyKey} was not found.`);
    }
  }

  async markNotFound(idempotencyKey: string, detail: string, now: Date): Promise<void> {
    this.database
      .prepare(
        `UPDATE submission_journal SET status='not-found', updated_at=?, detail=?
        WHERE idempotency_key=? AND status='prepared'`
      )
      .run(now.toISOString(), detail, idempotencyKey);
  }

  async unresolved(): Promise<SubmissionJournalEntry[]> {
    const rows = this.database
      .prepare(
        `SELECT idempotency_key, intent_json, status, prepared_at, updated_at,
        broker_order_id, detail FROM submission_journal WHERE status='prepared' ORDER BY prepared_at`
      )
      .all() as Array<Record<string, string | null>>;
    return rows.map((row) => ({
      idempotencyKey: row.idempotency_key!,
      intent: JSON.parse(row.intent_json!) as OrderIntent,
      status: "prepared",
      preparedAt: row.prepared_at!,
      updatedAt: row.updated_at!,
      ...(row.broker_order_id ? { brokerOrderId: row.broker_order_id } : {}),
      ...(row.detail ? { detail: row.detail } : {})
    }));
  }

  acquireLease(leaseName: string, ownerId: string, now: Date, ttlMs: number): boolean {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Lease ttlMs must be positive.");
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    return this.transaction(() => {
      this.database
        .prepare("DELETE FROM coordinator_lease WHERE lease_name=? AND expires_at<=?")
        .run(leaseName, now.toISOString());
      const existing = this.database
        .prepare("SELECT owner_id FROM coordinator_lease WHERE lease_name=?")
        .get(leaseName) as { owner_id: string } | undefined;
      if (existing && existing.owner_id !== ownerId) return false;
      this.database
        .prepare(
          `INSERT INTO coordinator_lease(lease_name, owner_id, expires_at) VALUES(?,?,?)
        ON CONFLICT(lease_name) DO UPDATE SET owner_id=excluded.owner_id, expires_at=excluded.expires_at`
        )
        .run(leaseName, ownerId, expiresAt);
      return true;
    });
  }

  releaseLease(leaseName: string, ownerId: string): void {
    this.database
      .prepare("DELETE FROM coordinator_lease WHERE lease_name=? AND owner_id=?")
      .run(leaseName, ownerId);
  }

  private transaction<T>(action: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
