import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import type { PortLogRuntimeEvent, PortLogRuntimeModel } from "@synara/contracts";

const MODEL_REF = "openrouter/deepseek/deepseek-v4-flash";
const SENTINEL = "PORTLOG_LIVE_SMOKE_OK";
const TURN_TIMEOUT_MS = 90_000;

type JsonRpcResponse = {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
  readonly error?: { readonly message?: unknown };
};

type PendingRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export class RuntimeClient {
  private readonly child: ChildProcess.ChildProcess;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly eventListeners = new Set<(event: PortLogRuntimeEvent) => void>();
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";

  constructor(key: string, dataDir: string, cwd: string) {
    const runtimeEntry = Path.join(Path.dirname(new URL(import.meta.url).pathname), "../dist/index.mjs");
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      PORTLOG_RUNTIME_DATA_DIR: dataDir,
      PORTLOG_RUNTIME_MODE: "live-smoke",
      PORTLOG_OPENROUTER_API_KEY: key,
    };
    this.child = ChildProcess.spawn("node", [runtimeEntry], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout?.setEncoding("utf8");
    this.child.stderr?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => this.consumeStdout(chunk));
    this.child.stderr?.on("data", (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-8_000);
    });
    this.child.on("error", (error) => this.rejectPending(error));
    this.child.on("exit", (code, signal) => {
      this.rejectPending(new Error(`runtime exited (${code ?? "null"}, ${signal ?? "none"})`));
    });
  }

  onEvent(listener: (event: PortLogRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  request<T>(method: string, params: unknown, timeoutMs = 10_000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async shutdown(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await this.request("runtime.shutdown", {}, 5_000).catch(() => undefined);
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolve();
        return;
      }
      this.child.once("exit", () => resolve());
      setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM");
        resolve();
      }, 1_000);
    });
  }

  forceKill(): void {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
  }

  diagnostic(): string {
    return this.stderrBuffer.trim();
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer = `${this.stdoutBuffer}${chunk}`;
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      let response: JsonRpcResponse;
      try {
        response = JSON.parse(line) as JsonRpcResponse;
      } catch {
        this.rejectPending(new Error("runtime emitted invalid JSON"));
        continue;
      }
      if (response.method === "runtime.event" && response.params) {
        for (const listener of this.eventListeners) listener(response.params as PortLogRuntimeEvent);
        continue;
      }
      if (typeof response.id !== "number") continue;
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error) {
        pending.reject(new Error(String(response.error.message ?? "runtime request failed")));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}

export async function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("live smoke must be run from an interactive terminal");
  }
  process.stdout.write(prompt);
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      input.removeListener("data", onData);
      input.setRawMode?.(false);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          finish(new Error("cancelled"));
          return;
        }
        if (byte === 4) {
          finish(new Error("no credential entered"));
          return;
        }
        if (byte === 13 || byte === 10) {
          finish();
          return;
        }
        if (byte === 127 || byte === 8) {
          value = value.slice(0, -1);
          continue;
        }
        if (byte >= 32) value += String.fromCharCode(byte);
      }
    };
    input.on("data", onData);
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function redact(text: string, secret: string): string {
  return text.split(secret).join("[redacted]");
}

async function main(): Promise<void> {
  if (!process.versions.bun) {
    throw new Error("run this command with Bun");
  }
  const environmentKey =
    process.env.PORTLOG_OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  const key = environmentKey ?? (await readSecret("OpenRouter API key (hidden): "));
  assert(key.length > 0, "an OpenRouter API key is required");
  if (environmentKey) console.log("Using OpenRouter credential from the process environment.");

  const fixtureDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "portlog-live-smoke-"));
  FS.writeFileSync(Path.join(fixtureDir, "fixture.txt"), SENTINEL, "utf8");
  const dataDir = Path.join(fixtureDir, "runtime");
  const client = new RuntimeClient(key, dataDir, fixtureDir);
  const events: PortLogRuntimeEvent[] = [];
  const unsubscribe = client.onEvent((event) => events.push(event));

  try {
    await client.request("runtime.initialize", {
      supportedProtocolVersions: [1],
      clientVersion: "live-smoke",
    });
    const models = await client.request<ReadonlyArray<PortLogRuntimeModel>>("model.list", {});
    const model = models.find((candidate) => candidate.ref === MODEL_REF);
    assert(model?.status === "ready", `model is not ready (${model?.status ?? "missing"})`);

    const project = await client.request<{ readonly projectId: string }>("project.open", {
      root: fixtureDir,
    });
    const session = await client.request<{ readonly sessionId: string }>("session.create", {
      projectId: project.projectId,
      modelRef: MODEL_REF,
      thinkingLevel: "low",
    });
    const turnId = Crypto.randomUUID();
    await client.request("turn.send", {
      sessionId: session.sessionId,
      turnId,
      modelRef: MODEL_REF,
      thinkingLevel: "low",
      text: `Use the read tool to read fixture.txt. Reply with the exact sentinel from the file: ${SENTINEL}`,
    });

    const deadline = Date.now() + TURN_TIMEOUT_MS;
    while (!events.some((event) => event.turnId === turnId && event.type === "turn.completed")) {
      if (Date.now() >= deadline) throw new Error("timed out waiting for turn.completed");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const turnEvents = events.filter((event) => event.turnId === turnId);
    const assistantText = turnEvents
      .filter((event): event is Extract<PortLogRuntimeEvent, { type: "assistant.delta" }> => event.type === "assistant.delta")
      .map((event) => event.delta)
      .join("");
    const readStarted = turnEvents.some(
      (event) => event.type === "tool.started" && event.toolName.toLowerCase() === "read",
    );
    const readCompleted = turnEvents.some(
      (event) => event.type === "tool.completed" && event.toolName.toLowerCase() === "read",
    );
    const completed = turnEvents.find(
      (event): event is Extract<PortLogRuntimeEvent, { type: "turn.completed" }> => event.type === "turn.completed",
    );

    assert(assistantText.length > 0, "no assistant deltas received");
    assert(readStarted && readCompleted, "read tool lifecycle was not observed");
    assert(completed?.state === "completed", `turn ended with ${completed?.state ?? "unknown"}`);
    assert(assistantText.includes(SENTINEL), "assistant output did not contain the fixture sentinel");

    console.log("PASS model.list: OpenRouter model ready");
    console.log("PASS turn.stream: assistant deltas received");
    console.log("PASS tool.read: started and completed");
    console.log("PASS turn.completed: completed with fixture sentinel");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = client.diagnostic();
    throw new Error(
      redact(`${message}${diagnostic ? `\n${diagnostic}` : ""}`, key),
    );
  } finally {
    unsubscribe();
    await client.shutdown();
    client.forceKill();
    FS.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(`FAIL live PortLog smoke: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
