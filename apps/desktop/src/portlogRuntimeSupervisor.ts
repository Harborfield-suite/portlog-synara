import * as ChildProcess from "node:child_process";
import * as Path from "node:path";
import * as readline from "node:readline";

import type {
  PortLogRuntimeArtifact,
  PortLogRuntimeArtifactDescription,
  PortLogRuntimeContentReadInput,
  PortLogRuntimeContentReadResult,
  PortLogRuntimeContentWriteInput,
  PortLogRuntimeContentWriteResult,
  PortLogRuntimeEvent,
  PortLogRuntimeEvidence,
  PortLogRuntimeEvidenceGetInput,
  PortLogRuntimeEvidenceListInput,
  PortLogRuntimeEvidenceRecordInput,
  PortLogRuntimeFinding,
  PortLogRuntimeFindingListInput,
  PortLogRuntimeFindingRecordInput,
  PortLogRuntimeHealth,
  PortLogRuntimeHistoryInput,
  PortLogRuntimeHistoryPage,
  PortLogRuntimeModel,
  PortLogRuntimeOpenProjectInput,
  PortLogRuntimeProject,
  PortLogRuntimeProjectDescription,
  PortLogRuntimeReady,
  PortLogRuntimeSession,
  PortLogRuntimeSessionAttachInput,
  PortLogRuntimeSessionCreateInput,
  PortLogRuntimeSessionSnapshot,
  PortLogRuntimeState,
  PortLogRuntimeTurnAccepted,
  PortLogRuntimeTurnInput,
  PortLogRuntimeWorkspaceListResult,
} from "@synara/contracts";

const INITIAL_STATE: PortLogRuntimeState = {
  status: "stopped",
  ready: null,
  error: null,
};
const PROTOCOL_VERSION = 1;
const STARTUP_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

interface RuntimeResponse {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
  readonly error?: {
    readonly message?: unknown;
    readonly data?: { readonly code?: unknown };
  };
}

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PortLogRuntimeSupervisorOptions {
  readonly runtimeEntry: string;
  readonly dataDir: string;
  readonly cwd: string;
  readonly spawn?: typeof ChildProcess.spawn;
}

export class PortLogRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PortLogRuntimeError";
    this.code = code;
  }
}

export class PortLogRuntimeSupervisor {
  private readonly options: PortLogRuntimeSupervisorOptions;
  private readonly spawn: typeof ChildProcess.spawn;
  private readonly listeners = new Set<(state: PortLogRuntimeState) => void>();
  private readonly eventListeners = new Set<(event: PortLogRuntimeEvent) => void>();
  private readonly pending = new Map<string | number, PendingRequest>();
  private state: PortLogRuntimeState = INITIAL_STATE;
  private child: ChildProcess.ChildProcess | null = null;
  private nextRequestId = 1;
  private stopping = false;

  constructor(options: PortLogRuntimeSupervisorOptions) {
    this.options = options;
    this.spawn = options.spawn ?? ChildProcess.spawn;
  }

  getStatus(): PortLogRuntimeState {
    return this.state;
  }

  onStatus(listener: (state: PortLogRuntimeState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: (event: PortLogRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async start(): Promise<PortLogRuntimeReady> {
    if (this.state.status === "ready" && this.state.ready) {
      return this.state.ready;
    }
    if (this.child) {
      throw new Error("PortLog runtime is already starting.");
    }

    if (!Path.isAbsolute(this.options.runtimeEntry)) {
      this.setError("RUNTIME_ENTRY_INVALID", "PortLog runtime entry must be absolute.");
      throw new PortLogRuntimeError("RUNTIME_ENTRY_INVALID", this.state.error ?? "Invalid entry.");
    }

    this.stopping = false;
    this.setState({ status: "starting", ready: null, error: null });

    const child = this.spawn(process.execPath, [this.options.runtimeEntry], {
      cwd: this.options.cwd,
      env: runtimeEnvironment(this.options.dataDir),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.attachChild(child);

    try {
      const ready = await this.request<PortLogRuntimeReady>(
        "runtime.initialize",
        {
          supportedProtocolVersions: [PROTOCOL_VERSION],
          clientVersion: "desktop",
        },
        STARTUP_TIMEOUT_MS,
      );
      this.setState({ status: "ready", ready, error: null });
      return ready;
    } catch (error) {
      this.setError(errorCode(error), formatError(error));
      await this.killChild();
      throw error;
    }
  }

  async listModels(): Promise<ReadonlyArray<PortLogRuntimeModel>> {
    return this.request<ReadonlyArray<PortLogRuntimeModel>>("model.list", {}, STARTUP_TIMEOUT_MS);
  }

  async openProject(input: PortLogRuntimeOpenProjectInput): Promise<PortLogRuntimeProject> {
    return this.request<PortLogRuntimeProject>("project.open", input, STARTUP_TIMEOUT_MS);
  }

  async describeProject(input: { readonly projectId: string }): Promise<PortLogRuntimeProjectDescription> {
    return this.request<PortLogRuntimeProjectDescription>("project.describe", input, STARTUP_TIMEOUT_MS);
  }

  async listWorkspace(input: {
    readonly projectId: string;
    readonly relativePath?: string;
    readonly includeFiles?: boolean;
  }): Promise<PortLogRuntimeWorkspaceListResult> {
    return this.request("workspace.list", input, STARTUP_TIMEOUT_MS);
  }

  async listArtifacts(input: { readonly projectId: string }): Promise<ReadonlyArray<PortLogRuntimeArtifact>> {
    return this.request<ReadonlyArray<PortLogRuntimeArtifact>>("artifact.list", input, STARTUP_TIMEOUT_MS);
  }

  async describeArtifact(input: {
    readonly projectId: string;
    readonly artifactId: string;
  }): Promise<PortLogRuntimeArtifactDescription> {
    return this.request<PortLogRuntimeArtifactDescription>("artifact.describe", input, STARTUP_TIMEOUT_MS);
  }

  async readContent(input: PortLogRuntimeContentReadInput): Promise<PortLogRuntimeContentReadResult> {
    return this.request<PortLogRuntimeContentReadResult>("content.read", input, STARTUP_TIMEOUT_MS);
  }

  async writeContent(input: PortLogRuntimeContentWriteInput): Promise<PortLogRuntimeContentWriteResult> {
    return this.request<PortLogRuntimeContentWriteResult>("content.write", input, STARTUP_TIMEOUT_MS);
  }

  async recordEvidence(input: PortLogRuntimeEvidenceRecordInput): Promise<PortLogRuntimeEvidence> {
    return this.request<PortLogRuntimeEvidence>("evidence.record", input, STARTUP_TIMEOUT_MS);
  }

  async getEvidence(input: PortLogRuntimeEvidenceGetInput): Promise<PortLogRuntimeEvidence> {
    return this.request<PortLogRuntimeEvidence>("evidence.get", input, STARTUP_TIMEOUT_MS);
  }

  async listEvidence(input: PortLogRuntimeEvidenceListInput): Promise<ReadonlyArray<PortLogRuntimeEvidence>> {
    return this.request<ReadonlyArray<PortLogRuntimeEvidence>>("evidence.list", input, STARTUP_TIMEOUT_MS);
  }

  async recordFinding(input: PortLogRuntimeFindingRecordInput): Promise<PortLogRuntimeFinding> {
    return this.request<PortLogRuntimeFinding>("finding.record", input, STARTUP_TIMEOUT_MS);
  }

  async listFindings(input: PortLogRuntimeFindingListInput): Promise<ReadonlyArray<PortLogRuntimeFinding>> {
    return this.request<ReadonlyArray<PortLogRuntimeFinding>>("finding.list", input, STARTUP_TIMEOUT_MS);
  }

  async createSession(input: PortLogRuntimeSessionCreateInput): Promise<PortLogRuntimeSession> {
    return this.request<PortLogRuntimeSession>("session.create", input, STARTUP_TIMEOUT_MS);
  }

  async sendTurn(input: PortLogRuntimeTurnInput): Promise<PortLogRuntimeTurnAccepted> {
    return this.request<PortLogRuntimeTurnAccepted>("turn.send", input, STARTUP_TIMEOUT_MS);
  }

  async cancelTurn(input: { readonly sessionId: string; readonly turnId: string }): Promise<{ accepted: true }> {
    return this.request<{ accepted: true }>("turn.cancel", input, STARTUP_TIMEOUT_MS);
  }

  async attachSession(input: PortLogRuntimeSessionAttachInput): Promise<PortLogRuntimeSessionSnapshot> {
    return this.request<PortLogRuntimeSessionSnapshot>("session.attach", input, STARTUP_TIMEOUT_MS);
  }

  async sessionHistory(input: PortLogRuntimeHistoryInput): Promise<PortLogRuntimeHistoryPage> {
    return this.request<PortLogRuntimeHistoryPage>("session.history", input, STARTUP_TIMEOUT_MS);
  }

  async health(): Promise<PortLogRuntimeHealth> {
    if (this.state.status !== "ready") {
      return {
        healthy: false,
        status: this.state.status,
        runtimeInstanceId: this.state.ready?.runtimeInstanceId ?? null,
      };
    }
    return this.request<PortLogRuntimeHealth>("runtime.health", {}, STARTUP_TIMEOUT_MS);
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.setState({ ...INITIAL_STATE });
      return;
    }

    this.stopping = true;
    try {
      if (this.state.status === "ready") {
        await this.request("runtime.shutdown", {}, SHUTDOWN_TIMEOUT_MS);
      }
    } catch {
      // The process may already be exiting; the bounded wait below is authoritative.
    }

    await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
    if (this.child === child) {
      await this.killChild();
    }
    this.setState({ ...INITIAL_STATE });
  }

  private attachChild(child: ChildProcess.ChildProcess): void {
    const stdout = child.stdout;
    if (stdout) {
      const input = readline.createInterface({ input: stdout, crlfDelay: Infinity });
      input.on("line", (line) => this.handleLine(line));
      child.once("exit", () => input.close());
    }
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const message = String(chunk).trim();
      if (message) console.warn(`[portlog-runtime] ${message}`);
    });
    child.once("error", (error) => {
      this.rejectPending(error);
      this.handleExit(error.message);
    });
    child.once("exit", (code, signal) => {
      this.rejectPending(new Error(`PortLog runtime exited (code=${code ?? "null"}, signal=${signal ?? "null"})`));
      this.handleExit(`exit code=${code ?? "null"} signal=${signal ?? "null"}`);
    });
  }

  private handleLine(line: string): void {
    let response: RuntimeResponse;
    try {
      response = JSON.parse(line) as RuntimeResponse;
    } catch {
      this.setError("RUNTIME_PROTOCOL_ERROR", "PortLog runtime emitted invalid JSON.");
      return;
    }
    if (response.method === "runtime.event") {
      if (response.params && typeof response.params === "object") {
        for (const listener of this.eventListeners) {
          listener(response.params as PortLogRuntimeEvent);
        }
      }
      return;
    }
    if (typeof response.id !== "string" && typeof response.id !== "number") return;

    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error) {
      pending.reject(
        new PortLogRuntimeError(
          typeof response.error.data?.code === "string"
            ? response.error.data.code
            : "RUNTIME_ERROR",
          typeof response.error.message === "string"
            ? response.error.message
            : "PortLog runtime request failed.",
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const child = this.child;
    const stdin = child?.stdin;
    if (!stdin || stdin.destroyed) {
      return Promise.reject(new Error("PortLog runtime is not running."));
    }

    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PortLogRuntimeError("RUNTIME_TIMEOUT", `${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (result) => resolve(result as T), reject, timer });
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private handleExit(reason: string): void {
    this.child = null;
    if (this.stopping) return;
    this.setError("RUNTIME_EXITED", `PortLog runtime stopped: ${reason}`);
  }

  private async killChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await waitForExit(child, 1_000);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }

  private setError(code: string, message: string): void {
    this.setState({ status: "error", ready: null, error: `${code}: ${message}` });
  }

  private setState(next: PortLogRuntimeState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

export function runtimeEnvironment(
  dataDir: string,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const names = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SYSTEMROOT",
    "WINDIR",
    "TMPDIR",
    "TEMP",
    "TMP",
  ];
  const env: NodeJS.ProcessEnv = {
    ELECTRON_RUN_AS_NODE: "1",
    PORTLOG_RUNTIME_DATA_DIR: dataDir,
    PORTLOG_RUNTIME_MODE: "desktop",
    ...(sourceEnv.PORTLOG_OPENROUTER_API_KEY?.trim() || sourceEnv.OPENROUTER_API_KEY?.trim()
      ? {
          PORTLOG_OPENROUTER_API_KEY:
            sourceEnv.PORTLOG_OPENROUTER_API_KEY?.trim() || sourceEnv.OPENROUTER_API_KEY?.trim(),
        }
      : {}),
    ...(sourceEnv.PORTLOG_OPENAI_API_KEY?.trim() || sourceEnv.OPENAI_API_KEY?.trim()
      ? {
          PORTLOG_OPENAI_API_KEY:
            sourceEnv.PORTLOG_OPENAI_API_KEY?.trim() || sourceEnv.OPENAI_API_KEY?.trim(),
        }
      : {}),
  };
  for (const name of names) {
    const value = sourceEnv[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function waitForExit(child: ChildProcess.ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function errorCode(error: unknown): string {
  return error instanceof PortLogRuntimeError ? error.code : "RUNTIME_START_FAILED";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
