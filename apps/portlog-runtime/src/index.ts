import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import * as readline from "node:readline";

import packageJson from "../package.json" with { type: "json" };
import type {
  PortLogRuntimeArtifact,
  PortLogRuntimeArtifactDescription,
  PortLogRuntimeContentWriteResult,
  PortLogRuntimeCapabilities,
  PortLogRuntimeEvent,
  PortLogRuntimeEvidence,
  PortLogRuntimeEvidenceListInput,
  PortLogRuntimeEvidenceRecordInput,
  PortLogRuntimeFinding,
  PortLogRuntimeFindingRecordInput,
  PortLogRuntimeHealth,
  PortLogRuntimeHistoryPage,
  PortLogRuntimeHistoryInput,
  PortLogRuntimeModel,
  PortLogRuntimeProject,
  PortLogRuntimeProjectDescription,
  PortLogRuntimeReady,
  PortLogRuntimeSession,
  PortLogRuntimeSessionAttachInput,
  PortLogRuntimeSessionSnapshot,
  PortLogRuntimeTurnAccepted,
  PortLogRuntimeWorkspaceListResult,
} from "@synara/contracts";

import { ControlStore, turnRequestFingerprint } from "./controlStore";
import { PiDriver } from "./piDriver";
import {
  describeArtifact,
  describeProject,
  ensureProjectRoot,
  listRegisteredArtifacts,
  listWorkspaceEntries,
  readContent,
  writeContent,
} from "./workbenchServices";

export const PORTLOG_RUNTIME_PROTOCOL_VERSION = 1 as const;
export const MAX_PROTOCOL_FRAME_BYTES = 1024 * 1024;

const RUNTIME_VERSION = packageJson.version;
const PI_VERSION = packageJson.portlog.piVersion;
const DEFAULT_DATA_DIR = Path.join(OS.tmpdir(), "portlog-runtime");
const DEFAULT_THINKING_LEVEL = "low";

const CAPABILITIES: PortLogRuntimeCapabilities = {
  tools: ["read", "write", "edit", "bash"],
  filesystemSandbox: false,
  toolApproval: false,
  shellAccess: "unrestricted-user-permissions",
};

type JsonRpcId = string | number;

type RuntimeRequest = {
  readonly jsonrpc: "2.0";
  readonly id?: JsonRpcId;
  readonly method?: unknown;
  readonly params?: unknown;
};

type RuntimeResponse = {
  readonly jsonrpc: "2.0";
  readonly id?: JsonRpcId | null;
  readonly method?: string;
  readonly result?: unknown;
  readonly params?: unknown;
  readonly error?: {
    readonly code: -32600 | -32601 | -32602 | -32000;
    readonly message: string;
    readonly data?: {
      readonly code: string;
    };
  };
};

type RuntimeErrorCode =
  | "INVALID_REQUEST"
  | "PROTOCOL_VERSION_MISMATCH"
  | "RUNTIME_ALREADY_ACTIVE"
  | "RUNTIME_FATAL"
  | "PROJECT_NOT_FOUND"
  | "MODEL_NOT_FOUND"
  | "INVALID_LOCATOR"
  | "PATH_OUTSIDE_PROJECT"
  | "ARTIFACT_NOT_FOUND"
  | "FILE_VERSION_CONFLICT"
  | "EVIDENCE_NOT_FOUND"
  | "INVALID_EVIDENCE"
  | "SESSION_NOT_FOUND"
  | "SESSION_BUSY"
  | "TURN_ID_CONFLICT"
  | "PI_RUNTIME_ERROR";

export class RuntimeLock {
  private handle: number | null = null;
  private lockPath: string | null = null;

  acquire(dataDir: string): RuntimeErrorCode | null {
    FS.mkdirSync(dataDir, { recursive: true });
    const lockPath = Path.join(dataDir, "runtime.lock");
    const owner = JSON.stringify({ pid: process.pid, runtimeInstanceId: RUNTIME_INSTANCE_ID });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = FS.openSync(lockPath, "wx");
        FS.writeFileSync(handle, owner, "utf8");
        this.handle = handle;
        this.lockPath = lockPath;
        return null;
      } catch (error) {
        if (!(error instanceof Error) || !isFileExistsError(error)) {
          throw error;
        }

        if (attempt === 0 && removeStaleLock(lockPath)) continue;
        return "RUNTIME_ALREADY_ACTIVE";
      }
    }

    return "RUNTIME_ALREADY_ACTIVE";
  }

  release(): void {
    if (this.handle !== null) {
      FS.closeSync(this.handle);
      this.handle = null;
    }
    if (this.lockPath !== null) {
      try {
        FS.unlinkSync(this.lockPath);
      } catch {
        // The lock may have been removed during crash recovery.
      }
      this.lockPath = null;
    }
  }
}

const RUNTIME_INSTANCE_ID = Crypto.randomUUID();
const runtimeLock = new RuntimeLock();
const dataDir = process.env.PORTLOG_RUNTIME_DATA_DIR?.trim() || DEFAULT_DATA_DIR;
const projects = new Map<string, PortLogRuntimeProject>();
const sessions = new Map<string, PortLogRuntimeSession>();
const streamCursors = new Map<string, number>();
const sessionEventBuffers = new Map<string, PortLogRuntimeEvent[]>();
const MAX_SESSION_EVENTS = 128;
const MAX_HISTORY_LIMIT = 100;
let initialized = false;
let shuttingDown = false;
let startupError: RuntimeErrorCode | null = null;
let stdoutClosed = false;
let driver: PiDriver | null = null;
let driverReady: Promise<void> | null = null;
let controlStore: ControlStore | null = null;

export function createRuntimeReady(): PortLogRuntimeReady {
  return {
    protocolVersion: PORTLOG_RUNTIME_PROTOCOL_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    runtimeInstanceId: RUNTIME_INSTANCE_ID,
    piVersion: PI_VERSION,
    capabilities: CAPABILITIES,
  };
}

function isFileExistsError(error: Error): boolean {
  return "code" in error && error.code === "EEXIST";
}

function removeStaleLock(lockPath: string): boolean {
  try {
    const raw = FS.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    if (typeof parsed.pid === "number" && isProcessAlive(parsed.pid)) return false;
    FS.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code !== "ESRCH";
  }
}

function writeResponse(response: RuntimeResponse): void {
  if (stdoutClosed) return;
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function writeEvent(event: PortLogRuntimeEvent): void {
  writeResponse({ jsonrpc: "2.0", method: "runtime.event", params: event });
}

function writeError(id: JsonRpcId | null, code: RuntimeErrorCode, message: string): void {
  writeResponse({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message,
      data: { code },
    },
  });
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function parseRuntimeRequest(line: string): RuntimeRequest | null {
  if (Buffer.byteLength(line, "utf8") > MAX_PROTOCOL_FRAME_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object") return null;
    const request = parsed as RuntimeRequest;
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") return null;
    if (request.id !== undefined && !isJsonRpcId(request.id)) return null;
    return request;
  } catch {
    return null;
  }
}

function paramsObject(params: unknown): Record<string, unknown> | null {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : null;
}

function requiredString(params: Record<string, unknown> | null, key: string): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function protocolVersionsFromParams(params: unknown): readonly number[] {
  const versions = paramsObject(params)?.supportedProtocolVersions;
  return Array.isArray(versions) && versions.every((version) => typeof version === "number")
    ? versions
    : [];
}

function parseModelRef(modelRef: string): { providerId: string; modelId: string } | null {
  const separator = modelRef.indexOf("/");
  if (separator <= 0 || separator === modelRef.length - 1) return null;
  return { providerId: modelRef.slice(0, separator), modelId: modelRef.slice(separator + 1) };
}

type RuntimeEventInput = PortLogRuntimeEvent extends infer Event
  ? Event extends PortLogRuntimeEvent
    ? Omit<Event, "createdAt" | "cursor"> & Partial<Pick<Event, "createdAt" | "cursor">>
    : never
  : never;

function emitRuntimeEvent(event: RuntimeEventInput): void {
  const cursor = (streamCursors.get(event.streamId) ?? 0) + 1;
  streamCursors.set(event.streamId, cursor);
  const normalized: PortLogRuntimeEvent = {
    ...event,
    createdAt: event.createdAt ?? new Date().toISOString(),
    cursor,
  } as PortLogRuntimeEvent;
  const buffer = sessionEventBuffers.get(event.sessionId) ?? [];
  buffer.push(normalized);
  if (buffer.length > MAX_SESSION_EVENTS) buffer.splice(0, buffer.length - MAX_SESSION_EVENTS);
  sessionEventBuffers.set(event.sessionId, buffer);
  controlStore?.saveEvent(normalized);
  if (normalized.type === "turn.completed" && normalized.turnId) {
    controlStore?.setTurnState(normalized.turnId, normalized.state);
  }
  writeEvent(normalized);
}

function sessionSnapshot(
  input: PortLogRuntimeSessionAttachInput,
): PortLogRuntimeSessionSnapshot {
  const session = sessions.get(input.sessionId);
  if (!session || !driver) throw new Error(`Session '${input.sessionId}' was not found.`);
  const streamId = driver.getStreamId(input.sessionId);
  const buffer = sessionEventBuffers.get(input.sessionId) ?? [];
  const persisted = controlStore?.listEvents(input.sessionId, MAX_SESSION_EVENTS) ?? [];
  const sourceEvents = buffer.length > 0
    ? buffer
    : persisted.map((event, index) => ({ ...event, streamId, cursor: index + 1 }));
  const cursor = buffer.length > 0 ? (streamCursors.get(streamId) ?? 0) : sourceEvents.length;
  const requestedCursor = input.afterCursor ?? 0;
  const canReplay = input.streamId === streamId &&
    (sourceEvents.length === 0 || requestedCursor >= (sourceEvents[0]?.cursor ?? 0) - 1);
  const events = canReplay
    ? sourceEvents.filter((event) => event.cursor > requestedCursor)
    : sourceEvents.slice(-MAX_SESSION_EVENTS);
  const latestState = controlStore?.getLatestTurnState(input.sessionId);
  const activeTurnId = driver.getActiveTurnId(input.sessionId) ?? undefined;
  return {
    sessionId: input.sessionId,
    streamId,
    cursor,
    state: activeTurnId ? "active" : latestState === "interrupted" ? "interrupted" : "idle",
    ...(activeTurnId ? { activeTurnId } : {}),
    events,
  };
}

async function openProject(params: unknown): Promise<PortLogRuntimeProject> {
  const values = paramsObject(params);
  const root = requiredString(values, "root");
  if (!root) throw new Error("project.open requires a workspace root.");
  const canonicalRoot = await ensureProjectRoot(root, values?.createIfMissing === true);
  const existing =
    [...projects.values()].find((project) => project.root === canonicalRoot) ??
    controlStore?.findProjectByRoot(canonicalRoot);
  if (existing) {
    projects.set(existing.projectId, existing);
    return existing;
  }
  const project = { projectId: Crypto.randomUUID(), root: canonicalRoot };
  controlStore?.saveProject(project);
  projects.set(project.projectId, project);
  return project;
}

function requireProject(params: unknown): PortLogRuntimeProject {
  const projectId = requiredString(paramsObject(params), "projectId");
  const project = projectId ? projects.get(projectId) : undefined;
  if (!project) throw new Error(`Project '${projectId ?? ""}' was not found.`);
  return project;
}

async function projectDescribe(params: unknown): Promise<PortLogRuntimeProjectDescription> {
  return describeProject(requireProject(params));
}

async function workspaceList(params: unknown): Promise<PortLogRuntimeWorkspaceListResult> {
  const values = paramsObject(params);
  const project = requireProject(params);
  return {
    projectId: project.projectId,
    entries: await listWorkspaceEntries(
      project,
      typeof values?.relativePath === "string" ? values.relativePath : "",
      values?.includeFiles !== false,
    ),
  };
}

async function artifactList(params: unknown): Promise<ReadonlyArray<PortLogRuntimeArtifact>> {
  return listRegisteredArtifacts(requireProject(params));
}

async function artifactDescribe(params: unknown): Promise<PortLogRuntimeArtifactDescription> {
  const project = requireProject(params);
  const artifactId = requiredString(paramsObject(params), "artifactId");
  if (!artifactId) throw new Error("artifact.describe requires artifactId.");
  return describeArtifact(project, artifactId);
}

async function contentWrite(params: unknown): Promise<PortLogRuntimeContentWriteResult> {
  const values = paramsObject(params);
  const projectId = requiredString(values, "projectId");
  const relativePath = requiredString(values, "relativePath");
  const contents = typeof values?.contents === "string" ? values.contents : null;
  if (!projectId || !relativePath || contents === null) {
    throw new Error("content.write requires projectId, relativePath, and contents.");
  }
  return writeContent(new Map(projects), {
    projectId,
    relativePath,
    contents,
    ...(typeof values?.expectedVersion === "string" || values?.expectedVersion === null
      ? { expectedVersion: values.expectedVersion }
      : {}),
  });
}

async function contentRead(params: unknown) {
  const values = paramsObject(params);
  const locator = requiredString(values, "locator");
  if (!locator) throw new Error("content.read requires locator.");
  const offset = typeof values?.offset === "number" ? Math.max(0, values.offset) : undefined;
  const maxBytes = typeof values?.maxBytes === "number" ? Math.max(1, values.maxBytes) : undefined;
  return readContent(projects, { locator, ...(offset === undefined ? {} : { offset }), ...(maxBytes === undefined ? {} : { maxBytes }) });
}

function requiredClaimStatus(value: unknown): PortLogRuntimeEvidenceRecordInput["claimStatus"] {
  if (value === "satisfied" || value === "violated" || value === "indeterminate") return value;
  throw new Error("evidence.record requires a valid claimStatus.");
}

function requiredSupportStatus(value: unknown): PortLogRuntimeEvidenceRecordInput["supportStatus"] {
  if (value === "unverified" || value === "supported" || value === "incomplete" || value === "conflicting") {
    return value;
  }
  throw new Error("evidence.record requires a valid supportStatus.");
}

async function recordEvidence(params: unknown): Promise<PortLogRuntimeEvidence> {
  const values = paramsObject(params);
  const project = requireProject(params);
  const sourceLocator = requiredString(values, "sourceLocator");
  const sourceIdentity = requiredString(values, "sourceIdentity");
  const sourceSha256 = requiredString(values, "sourceSha256");
  const claim = requiredString(values, "claim");
  if (!sourceLocator || !sourceIdentity || !sourceSha256 || !claim) {
    throw new Error("evidence.record requires sourceLocator, sourceIdentity, sourceSha256, and claim.");
  }
  const artifactId = typeof values?.artifactId === "string" ? values.artifactId.trim() : undefined;
  if (artifactId) await describeArtifact(project, artifactId);
  const evidence: PortLogRuntimeEvidence = {
    evidenceId: Crypto.randomUUID(),
    projectId: project.projectId,
    ...(artifactId ? { artifactId } : {}),
    sourceLocator,
    sourceIdentity,
    sourceSha256,
    claim,
    claimStatus: requiredClaimStatus(values?.claimStatus),
    supportStatus: requiredSupportStatus(values?.supportStatus),
    ...(typeof values?.createdByTurn === "string" ? { createdByTurn: values.createdByTurn } : {}),
    createdAt: new Date().toISOString(),
  };
  controlStore?.saveEvidence(evidence);
  return evidence;
}

async function getEvidence(params: unknown): Promise<PortLogRuntimeEvidence> {
  const project = requireProject(params);
  const evidenceId = requiredString(paramsObject(params), "evidenceId");
  if (!evidenceId) throw new Error("evidence.get requires evidenceId.");
  const evidence = controlStore?.getEvidence(project.projectId, evidenceId);
  if (!evidence) throw new Error(`Evidence '${evidenceId}' was not found.`);
  if (!evidence.artifactId) return evidence;
  const artifact = await describeArtifact(project, evidence.artifactId).catch(() => null);
  return { ...evidence, sourceChanged: artifact ? artifact.sha256 !== evidence.sourceSha256 : true };
}

function listEvidence(params: unknown): ReadonlyArray<PortLogRuntimeEvidence> {
  const project = requireProject(params as PortLogRuntimeEvidenceListInput);
  return controlStore?.listEvidence(project.projectId) ?? [];
}

function recordFinding(params: unknown): PortLogRuntimeFinding {
  const values = paramsObject(params);
  const project = requireProject(params);
  const title = requiredString(values, "title");
  const summary = requiredString(values, "summary");
  if (!title || !summary) throw new Error("finding.record requires title and summary.");
  const evidenceIds = Array.isArray(values?.evidenceIds)
    ? values.evidenceIds.filter((value): value is string => typeof value === "string")
    : [];
  for (const evidenceId of evidenceIds) {
    if (!controlStore?.getEvidence(project.projectId, evidenceId)) {
      throw new Error(`Evidence '${evidenceId}' was not found.`);
    }
  }
  const finding: PortLogRuntimeFinding = {
    findingId: Crypto.randomUUID(),
    projectId: project.projectId,
    ...(typeof values?.sessionId === "string" ? { sessionId: values.sessionId } : {}),
    title,
    summary,
    claimStatus: requiredClaimStatus(values?.claimStatus),
    status: values?.status === "resolved" || values?.status === "dismissed" ? values.status : "open",
    evidenceIds,
    ...(typeof values?.createdByTurn === "string" ? { createdByTurn: values.createdByTurn } : {}),
    createdAt: new Date().toISOString(),
  };
  controlStore?.saveFinding(finding);
  return finding;
}

function listFindings(params: unknown): ReadonlyArray<PortLogRuntimeFinding> {
  const values = paramsObject(params);
  const project = requireProject(params);
  const sessionId = typeof values?.sessionId === "string" ? values.sessionId : undefined;
  return controlStore?.listFindings(project.projectId, sessionId) ?? [];
}

async function listModels(): Promise<ReadonlyArray<PortLogRuntimeModel>> {
  if (!driver) throw new Error("Pi driver is not initialized.");
  return driver.listModels();
}

async function rehydrateSessions(): Promise<void> {
  if (!controlStore || !driver) return;
  for (const project of controlStore.listProjects()) projects.set(project.projectId, project);
  for (const stored of controlStore.listSessions()) {
    const project = projects.get(stored.projectId);
    if (!project) continue;
    try {
      await driver.createSession({
        sessionId: stored.sessionId,
        cwd: project.root,
        modelRef: stored.modelRef,
        thinkingLevel: stored.thinkingLevel,
        piSessionFile: stored.piSessionFile,
      });
      const session: PortLogRuntimeSession = {
        sessionId: stored.sessionId,
        projectId: stored.projectId,
        modelRef: stored.modelRef,
        thinkingLevel: stored.thinkingLevel,
      };
      sessions.set(session.sessionId, session);
      controlStore.saveSession({ ...stored, thinkingLevel: stored.thinkingLevel });
    } catch (error) {
      process.stderr.write(`PortLog session recovery skipped: ${formatError(error)}\\n`);
    }
  }
}

async function createSession(params: unknown): Promise<PortLogRuntimeSession> {
  const values = paramsObject(params);
  const projectId = requiredString(values, "projectId");
  const modelRef = requiredString(values, "modelRef");
  if (!projectId || !modelRef) throw new Error("session.create requires projectId and modelRef.");
  const project = projects.get(projectId);
  if (!project) throw new Error(`Project '${projectId}' was not found.`);
  const model = parseModelRef(modelRef);
  if (!model) throw new Error(`Invalid model reference '${modelRef}'.`);
  const thinkingLevel = requiredString(values, "thinkingLevel") ?? DEFAULT_THINKING_LEVEL;
  if (!driver) throw new Error("Pi driver is not initialized.");
  const sessionId = Crypto.randomUUID();
  const created = await driver.createSession({
    sessionId,
    cwd: project.root,
    modelRef,
    thinkingLevel,
  });
  const session: PortLogRuntimeSession = {
    sessionId,
    projectId,
    modelRef,
    thinkingLevel: created.thinkingLevel,
  };
  controlStore?.saveSession({
    ...session,
    piSessionFile: created.piSessionFile,
  });
  sessions.set(session.sessionId, session);
  return session;
}

async function sendTurn(params: unknown): Promise<PortLogRuntimeTurnAccepted> {
  const values = paramsObject(params);
  const sessionId = requiredString(values, "sessionId");
  const turnId = requiredString(values, "turnId");
  const text = requiredString(values, "text");
  if (!sessionId || !turnId || !text) {
    throw new Error("turn.send requires sessionId, turnId, and text.");
  }
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session '${sessionId}' was not found.`);
  if (!driver) throw new Error("Pi driver is not initialized.");

  const modelRef = requiredString(values, "modelRef") ?? session.modelRef;
  const requestedThinkingLevel = requiredString(values, "thinkingLevel") ?? session.thinkingLevel;
  const thinkingLevel = driver.getEffectiveThinkingLevel(modelRef, requestedThinkingLevel);
  const requestFingerprint = turnRequestFingerprint({
    sessionId,
    text,
    modelRef,
    thinkingLevel,
  });
  const existing = controlStore?.getTurn(turnId);
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint) throw new Error("TURN_ID_CONFLICT");
    return { accepted: true, sessionId, turnId };
  }
  if (driver.isTurnActive(sessionId)) throw new Error("A turn is already active for this session.");

  controlStore?.acceptTurn({
    turnId,
    sessionId,
    requestFingerprint,
    modelRef,
    thinkingLevel,
  });
  emitRuntimeEvent({
    streamId: driver.getStreamId(sessionId),
    cursor: 0,
    sessionId,
    turnId,
    type: "user.message",
    text,
  });

  try {
    const effectiveThinkingLevel = await driver.configureSession(
      sessionId,
      modelRef,
      thinkingLevel,
    );
    const updatedSession = { ...session, modelRef, thinkingLevel: effectiveThinkingLevel };
    sessions.set(sessionId, updatedSession);
    controlStore?.updateSessionModel(sessionId, modelRef, effectiveThinkingLevel);
    controlStore?.setTurnState(turnId, "running");
    void driver.sendTurn(sessionId, turnId, text).catch((error) => {
      controlStore?.setTurnState(turnId, "failed");
      const message = error instanceof Error ? error.message : String(error);
      emitRuntimeEvent({
        streamId: "runtime",
        cursor: 0,
        sessionId,
        turnId,
        type: "runtime.error",
        code: "PI_RUNTIME_ERROR",
        message,
      });
    });
  } catch (error) {
    controlStore?.setTurnState(turnId, "failed");
    throw error;
  }
  return { accepted: true, sessionId, turnId };
}

async function cancelTurn(params: unknown): Promise<{ accepted: true }> {
  const values = paramsObject(params);
  const sessionId = requiredString(values, "sessionId");
  const turnId = requiredString(values, "turnId");
  if (!sessionId || !turnId) throw new Error("turn.cancel requires sessionId and turnId.");
  if (!driver) throw new Error("Pi driver is not initialized.");
  await driver.cancelTurn(sessionId, turnId);
  return { accepted: true };
}

function sessionHistory(params: unknown): PortLogRuntimeHistoryPage {
  const values = paramsObject(params);
  const sessionId = requiredString(values, "sessionId");
  if (!sessionId || !sessions.has(sessionId)) {
    throw new Error(`Session '${sessionId ?? ""}' was not found.`);
  }
  const offset = Math.max(0, Number(values?.offset ?? 0) || 0);
  const limit = Math.min(MAX_HISTORY_LIMIT, Math.max(1, Number(values?.limit ?? 20) || 20));
  const page = controlStore?.listTurns(sessionId, offset, limit) ?? { turns: [], hasMore: false };
  return {
    sessionId,
    offset,
    limit,
    hasMore: page.hasMore,
    turns: page.turns.map(({ turnId, sessionId: storedSessionId, modelRef, thinkingLevel, state }) => ({
      turnId,
      sessionId: storedSessionId,
      modelRef,
      thinkingLevel,
      state,
    })),
  };
}

async function handleRequest(request: RuntimeRequest): Promise<void> {
  const id = request.id ?? null;
  if (!isJsonRpcId(request.id)) {
    writeError(id, "INVALID_REQUEST", "Requests require a string or numeric id.");
    return;
  }

  if (request.method === "runtime.initialize") {
    if (startupError !== null) {
      writeError(id, startupError, "PortLog runtime could not initialize.");
      return;
    }
    if (!protocolVersionsFromParams(request.params).includes(PORTLOG_RUNTIME_PROTOCOL_VERSION)) {
      writeError(id, "PROTOCOL_VERSION_MISMATCH", "No compatible PortLog protocol version.");
      return;
    }
    try {
      await driverReady;
      await rehydrateSessions();
    } catch (error) {
      startupError = "RUNTIME_FATAL";
      writeError(id, startupError, formatError(error));
      return;
    }
    initialized = true;
    writeResponse({ jsonrpc: "2.0", id, result: createRuntimeReady() });
    return;
  }

  if (!initialized) {
    writeError(id, "INVALID_REQUEST", "runtime.initialize must succeed first.");
    return;
  }

  try {
    switch (request.method) {
      case "runtime.health":
        writeResponse({
          jsonrpc: "2.0",
          id,
          result: {
            healthy: !shuttingDown,
            status: shuttingDown ? "stopping" : "ready",
            runtimeInstanceId: RUNTIME_INSTANCE_ID,
          } satisfies PortLogRuntimeHealth,
        });
        return;
      case "runtime.shutdown":
        shuttingDown = true;
        await driver?.dispose();
        controlStore?.close();
        controlStore = null;
        writeResponse({ jsonrpc: "2.0", id, result: { accepted: true } });
        setImmediate(() => process.exit(0));
        return;
      case "model.list":
        writeResponse({ jsonrpc: "2.0", id, result: await listModels() });
        return;
      case "project.open":
        writeResponse({ jsonrpc: "2.0", id, result: await openProject(request.params) });
        return;
      case "project.describe":
        writeResponse({ jsonrpc: "2.0", id, result: await projectDescribe(request.params) });
        return;
      case "workspace.list":
        writeResponse({ jsonrpc: "2.0", id, result: await workspaceList(request.params) });
        return;
      case "artifact.list":
        writeResponse({ jsonrpc: "2.0", id, result: await artifactList(request.params) });
        return;
      case "artifact.describe":
        writeResponse({ jsonrpc: "2.0", id, result: await artifactDescribe(request.params) });
        return;
      case "content.read":
        writeResponse({ jsonrpc: "2.0", id, result: await contentRead(request.params) });
        return;
      case "content.write":
        writeResponse({ jsonrpc: "2.0", id, result: await contentWrite(request.params) });
        return;
      case "evidence.record":
        writeResponse({ jsonrpc: "2.0", id, result: await recordEvidence(request.params) });
        return;
      case "evidence.get":
        writeResponse({ jsonrpc: "2.0", id, result: await getEvidence(request.params) });
        return;
      case "evidence.list":
        writeResponse({ jsonrpc: "2.0", id, result: listEvidence(request.params) });
        return;
      case "finding.record":
        writeResponse({ jsonrpc: "2.0", id, result: recordFinding(request.params) });
        return;
      case "finding.list":
        writeResponse({ jsonrpc: "2.0", id, result: listFindings(request.params) });
        return;
      case "session.create":
        writeResponse({ jsonrpc: "2.0", id, result: await createSession(request.params) });
        return;
      case "turn.send":
        writeResponse({ jsonrpc: "2.0", id, result: await sendTurn(request.params) });
        return;
      case "turn.cancel":
        writeResponse({ jsonrpc: "2.0", id, result: await cancelTurn(request.params) });
        return;
      case "session.attach":
      case "session.snapshot":
        writeResponse({ jsonrpc: "2.0", id, result: sessionSnapshot(request.params as PortLogRuntimeSessionAttachInput) });
        return;
      case "session.history":
        writeResponse({ jsonrpc: "2.0", id, result: sessionHistory(request.params as PortLogRuntimeHistoryInput) });
        return;
      default:
        writeError(id, "INVALID_REQUEST", `Unsupported method: ${String(request.method)}.`);
    }
  } catch (error) {
    const message = formatError(error);
    const explicitCode =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : null;
    const code: RuntimeErrorCode = explicitCode === "INVALID_LOCATOR" ||
      explicitCode === "PATH_OUTSIDE_PROJECT" ||
      explicitCode === "ARTIFACT_NOT_FOUND" ||
      explicitCode === "FILE_VERSION_CONFLICT"
      ? explicitCode
      : message === "TURN_ID_CONFLICT"
        ? "TURN_ID_CONFLICT"
        : message.includes("was not found")
          ? "SESSION_NOT_FOUND"
          : message.includes("already active")
            ? "SESSION_BUSY"
            : message.includes("model")
              ? "MODEL_NOT_FOUND"
              : "PI_RUNTIME_ERROR";
    writeError(id, code, message);
  }
}

async function start(): Promise<void> {
  try {
    startupError = runtimeLock.acquire(dataDir);
    if (!startupError) {
      controlStore = await ControlStore.open(dataDir);
      controlStore.markInterrupted();
      driver = new PiDriver({
        dataDir,
        onEvent: (sessionId, event) => {
          emitRuntimeEvent({ ...event, sessionId });
        },
      });
      driverReady = driver.initialize();
    }
  } catch (error) {
    startupError = "RUNTIME_FATAL";
    process.stderr.write(`PortLog runtime startup failed: ${formatError(error)}\n`);
  }

  process.on("exit", () => {
    controlStore?.close();
    runtimeLock.release();
  });

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let requestQueue = Promise.resolve();
  input.on("line", (line) => {
    requestQueue = requestQueue.then(async () => {
      const request = parseRuntimeRequest(line);
      if (request === null) {
        writeError(null, "INVALID_REQUEST", "Invalid or oversized JSON-RPC frame.");
        return;
      }
      await handleRequest(request);
    });
  });
  input.on("close", () => {
    void requestQueue.finally(() => {
      stdoutClosed = true;
      if (!shuttingDown) process.exitCode = 0;
    });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) void start();
