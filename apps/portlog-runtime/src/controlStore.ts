import * as FS from "node:fs";
import * as Path from "node:path";
import { createHash } from "node:crypto";

import type {
  PortLogRuntimeClaimStatus,
  PortLogRuntimeEvent,
  PortLogRuntimeEvidence,
  PortLogRuntimeEvidenceSupportStatus,
  PortLogRuntimeFinding,
  PortLogRuntimeFindingStatus,
} from "@synara/contracts";

type DatabaseSync = import("node:sqlite").DatabaseSync;

export type StoredSession = {
  readonly sessionId: string;
  readonly projectId: string;
  readonly modelRef: string;
  readonly thinkingLevel: string;
  readonly piSessionFile: string;
};

export type StoredTurn = {
  readonly turnId: string;
  readonly sessionId: string;
  readonly requestFingerprint: string;
  readonly modelRef: string;
  readonly thinkingLevel: string;
  readonly state: "accepted" | "running" | "completed" | "cancelled" | "interrupted" | "failed";
};

type StoredEvidence = Omit<PortLogRuntimeEvidence, "sourceChanged">;
type StoredFinding = PortLogRuntimeFinding;

export type TurnAcceptance =
  | { readonly kind: "new"; readonly turn: StoredTurn }
  | { readonly kind: "existing"; readonly turn: StoredTurn };

export function turnRequestFingerprint(input: {
  readonly sessionId: string;
  readonly text: string;
  readonly modelRef: string;
  readonly thinkingLevel: string;
}): string {
  return createHash("sha256")
    .update(input.sessionId)
    .update("\0")
    .update(input.text)
    .update("\0")
    .update(input.modelRef)
    .update("\0")
    .update(input.thinkingLevel)
    .digest("hex");
}

export class ControlStore {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static async open(dataDir: string): Promise<ControlStore> {
    FS.mkdirSync(dataDir, { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(Path.join(dataDir, "control.sqlite"));
    const store = new ControlStore(db);
    store.migrate();
    return store;
  }

  close(): void {
    this.db.close();
  }

  saveEvent(event: PortLogRuntimeEvent): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runtime_events(session_id, stream_id, cursor, event_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(event.sessionId, event.streamId, event.cursor, JSON.stringify(event));
  }

  listEvents(sessionId: string, limit: number): ReadonlyArray<PortLogRuntimeEvent> {
    const rows = this.db
      .prepare(
        `SELECT event_json
         FROM runtime_events
         WHERE session_id = ?
         ORDER BY event_id DESC
         LIMIT ?`,
      )
      .all(sessionId, limit) as Array<Record<string, unknown>>;
    return rows
      .reverse()
      .map((row) => JSON.parse(String(row.event_json)) as PortLogRuntimeEvent);
  }

  markInterrupted(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `UPDATE turns
           SET state = 'interrupted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE state IN ('accepted', 'running')`,
        )
        .run();
      this.db
        .prepare(
          `UPDATE sessions
           SET state = 'interrupted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE state = 'active'`,
        )
        .run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listProjects(): ReadonlyArray<{ readonly projectId: string; readonly root: string }> {
    return (this.db.prepare("SELECT project_id, root FROM projects ORDER BY created_at").all() as Array<Record<string, unknown>>).map((row) => ({
      projectId: String(row.project_id),
      root: String(row.root),
    }));
  }

  listSessions(): ReadonlyArray<StoredSession> {
    return (this.db.prepare("SELECT session_id, project_id, model_ref, thinking_level, pi_session_file FROM sessions ORDER BY created_at").all() as Array<Record<string, unknown>>).map((row) => ({
      sessionId: String(row.session_id),
      projectId: String(row.project_id),
      modelRef: String(row.model_ref),
      thinkingLevel: String(row.thinking_level),
      piSessionFile: String(row.pi_session_file),
    }));
  }

  findProjectByRoot(root: string): { readonly projectId: string; readonly root: string } | null {
    const row = this.db
      .prepare("SELECT project_id, root FROM projects WHERE root = ?")
      .get(root) as Record<string, unknown> | undefined;
    return row
      ? { projectId: String(row.project_id), root: String(row.root) }
      : null;
  }

  saveProject(project: { readonly projectId: string; readonly root: string }): void {
    this.db
      .prepare(
        `INSERT INTO projects(project_id, root)
         VALUES (?, ?)
         ON CONFLICT(project_id) DO UPDATE SET root = excluded.root,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(project.projectId, project.root);
  }

  saveSession(session: StoredSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions(session_id, project_id, model_ref, thinking_level, pi_session_file, state)
         VALUES (?, ?, ?, ?, ?, 'active')
         ON CONFLICT(session_id) DO UPDATE SET
           model_ref = excluded.model_ref,
           thinking_level = excluded.thinking_level,
           pi_session_file = excluded.pi_session_file,
           state = 'active',
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(
        session.sessionId,
        session.projectId,
        session.modelRef,
        session.thinkingLevel,
        session.piSessionFile,
      );
  }

  updateSessionModel(sessionId: string, modelRef: string, thinkingLevel: string): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET model_ref = ?, thinking_level = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE session_id = ?`,
      )
      .run(modelRef, thinkingLevel, sessionId);
  }

  acceptTurn(input: {
    readonly turnId: string;
    readonly sessionId: string;
    readonly requestFingerprint: string;
    readonly modelRef: string;
    readonly thinkingLevel: string;
  }): TurnAcceptance {
    const existing = this.readTurn(input.turnId);
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new Error("TURN_ID_CONFLICT");
      }
      return { kind: "existing", turn: existing };
    }
    this.db
      .prepare(
        `INSERT INTO turns(turn_id, session_id, request_fingerprint, model_ref, thinking_level, state)
         VALUES (?, ?, ?, ?, ?, 'accepted')`,
      )
      .run(
        input.turnId,
        input.sessionId,
        input.requestFingerprint,
        input.modelRef,
        input.thinkingLevel,
      );
    return {
      kind: "new",
      turn: {
        turnId: input.turnId,
        sessionId: input.sessionId,
        requestFingerprint: input.requestFingerprint,
        modelRef: input.modelRef,
        thinkingLevel: input.thinkingLevel,
        state: "accepted",
      },
    };
  }

  getTurn(turnId: string): StoredTurn | null {
    return this.readTurn(turnId);
  }

  getLatestTurnState(sessionId: string): StoredTurn["state"] | null {
    const row = this.db
      .prepare("SELECT state FROM turns WHERE session_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? (String(row.state) as StoredTurn["state"]) : null;
  }

  listTurns(sessionId: string, offset: number, limit: number): {
    readonly turns: ReadonlyArray<StoredTurn>;
    readonly hasMore: boolean;
  } {
    const rows = this.db
      .prepare(
        `SELECT turn_id, session_id, request_fingerprint, model_ref, thinking_level, state
         FROM turns WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(sessionId, limit + 1, offset) as Array<Record<string, unknown>>;
    return {
      turns: rows.slice(0, limit).map((row) => ({
        turnId: String(row.turn_id),
        sessionId: String(row.session_id),
        requestFingerprint: String(row.request_fingerprint),
        modelRef: String(row.model_ref),
        thinkingLevel: String(row.thinking_level),
        state: String(row.state) as StoredTurn["state"],
      })),
      hasMore: rows.length > limit,
    };
  }

  setTurnState(turnId: string, state: StoredTurn["state"]): void {
    this.db
      .prepare(
        `UPDATE turns
         SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE turn_id = ?`,
      )
      .run(state, turnId);
  }

  saveEvidence(input: Omit<StoredEvidence, "createdAt"> & { readonly createdAt?: string }): StoredEvidence {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO evidence(
          evidence_id, project_id, artifact_id, source_locator, source_identity,
          source_sha256, claim, claim_status, support_status, created_by_turn, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(evidence_id) DO UPDATE SET
           artifact_id = excluded.artifact_id,
           source_locator = excluded.source_locator,
           source_identity = excluded.source_identity,
           source_sha256 = excluded.source_sha256,
           claim = excluded.claim,
           claim_status = excluded.claim_status,
           support_status = excluded.support_status,
           created_by_turn = excluded.created_by_turn`,
      )
      .run(
        input.evidenceId,
        input.projectId,
        input.artifactId ?? null,
        input.sourceLocator,
        input.sourceIdentity,
        input.sourceSha256,
        input.claim,
        input.claimStatus,
        input.supportStatus,
        input.createdByTurn ?? null,
        createdAt,
      );
    return { ...input, createdAt };
  }

  getEvidence(projectId: string, evidenceId: string): StoredEvidence | null {
    const row = this.db
      .prepare("SELECT * FROM evidence WHERE project_id = ? AND evidence_id = ?")
      .get(projectId, evidenceId) as Record<string, unknown> | undefined;
    return row ? readEvidenceRow(row) : null;
  }

  listEvidence(projectId: string): ReadonlyArray<StoredEvidence> {
    const rows = this.db
      .prepare("SELECT * FROM evidence WHERE project_id = ? ORDER BY created_at")
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map(readEvidenceRow);
  }

  saveFinding(input: Omit<StoredFinding, "createdAt"> & { readonly createdAt?: string }): StoredFinding {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO findings(
          finding_id, project_id, session_id, title, summary, claim_status,
          status, evidence_ids_json, created_by_turn, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(finding_id) DO UPDATE SET
           title = excluded.title,
           summary = excluded.summary,
           claim_status = excluded.claim_status,
           status = excluded.status,
           evidence_ids_json = excluded.evidence_ids_json,
           created_by_turn = excluded.created_by_turn`,
      )
      .run(
        input.findingId,
        input.projectId,
        input.sessionId ?? null,
        input.title,
        input.summary,
        input.claimStatus,
        input.status,
        JSON.stringify(input.evidenceIds),
        input.createdByTurn ?? null,
        createdAt,
      );
    return { ...input, createdAt };
  }

  listFindings(projectId: string, sessionId?: string): ReadonlyArray<StoredFinding> {
    const rows = (sessionId
      ? this.db.prepare("SELECT * FROM findings WHERE project_id = ? AND session_id = ? ORDER BY created_at").all(projectId, sessionId)
      : this.db.prepare("SELECT * FROM findings WHERE project_id = ? ORDER BY created_at").all(projectId)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      findingId: String(row.finding_id),
      projectId: String(row.project_id),
      ...(row.session_id ? { sessionId: String(row.session_id) } : {}),
      title: String(row.title),
      summary: String(row.summary),
      claimStatus: String(row.claim_status) as PortLogRuntimeClaimStatus,
      status: String(row.status) as PortLogRuntimeFindingStatus,
      evidenceIds: parseStringArray(row.evidence_ids_json),
      ...(row.created_by_turn ? { createdByTurn: String(row.created_by_turn) } : {}),
      createdAt: String(row.created_at),
    }));
  }

  private readTurn(turnId: string): StoredTurn | null {
    const row = this.db
      .prepare(
        `SELECT turn_id, session_id, request_fingerprint, model_ref, thinking_level, state
         FROM turns WHERE turn_id = ?`,
      )
      .get(turnId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      turnId: String(row.turn_id),
      sessionId: String(row.session_id),
      requestFingerprint: String(row.request_fingerprint),
      modelRef: String(row.model_ref),
      thinkingLevel: String(row.thinking_level),
      state: String(row.state) as StoredTurn["state"],
    };
  }

  private migrate(): void {
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        root TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        model_ref TEXT NOT NULL,
        thinking_level TEXT NOT NULL,
        pi_session_file TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'interrupted')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS turns (
        turn_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        request_fingerprint TEXT NOT NULL,
        model_ref TEXT NOT NULL,
        thinking_level TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('accepted', 'running', 'completed', 'cancelled', 'interrupted', 'failed')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS evidence (
        evidence_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        artifact_id TEXT,
        source_locator TEXT NOT NULL,
        source_identity TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        claim TEXT NOT NULL,
        claim_status TEXT NOT NULL CHECK (claim_status IN ('satisfied', 'violated', 'indeterminate')),
        support_status TEXT NOT NULL CHECK (support_status IN ('unverified', 'supported', 'incomplete', 'conflicting')),
        created_by_turn TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS findings (
        finding_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        session_id TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        claim_status TEXT NOT NULL CHECK (claim_status IN ('satisfied', 'violated', 'indeterminate')),
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
        evidence_ids_json TEXT NOT NULL,
        created_by_turn TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        cursor INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (stream_id, cursor)
      );
      INSERT OR IGNORE INTO schema_migrations(version, applied_at)
      VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `);
  }
}

function readEvidenceRow(row: Record<string, unknown>): StoredEvidence {
  return {
    evidenceId: String(row.evidence_id),
    projectId: String(row.project_id),
    ...(row.artifact_id ? { artifactId: String(row.artifact_id) } : {}),
    sourceLocator: String(row.source_locator),
    sourceIdentity: String(row.source_identity),
    sourceSha256: String(row.source_sha256),
    claim: String(row.claim),
    claimStatus: String(row.claim_status) as PortLogRuntimeClaimStatus,
    supportStatus: String(row.support_status) as PortLogRuntimeEvidenceSupportStatus,
    ...(row.created_by_turn ? { createdByTurn: String(row.created_by_turn) } : {}),
    createdAt: String(row.created_at),
  };
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
