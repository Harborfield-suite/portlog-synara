import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import type { PortLogRuntimeEvent, PortLogRuntimeUsage } from "@synara/contracts";

import { readSecret, redact, RuntimeClient } from "./liveSmoke";
import { PORTLOG_TOOL_POLICY } from "./toolPolicy";

const DEFAULT_MODEL_REF = "openrouter/deepseek/deepseek-v4-flash";
const DEFAULT_RUNS = 3;
const TURN_TIMEOUT_MS = 180_000;
const ANSWER_PATH = Path.join("workspace", "structured_answer.json");

type RunResult = {
  readonly run: number;
  readonly success: boolean;
  readonly durationMs: number;
  readonly toolCalls: number;
  readonly toolNames: readonly string[];
  readonly userInterventions: 0;
  readonly verdict?: string;
  readonly witnessIds?: readonly string[];
  readonly witnessCoverage?: number;
  readonly unsupportedWitnessIds?: readonly string[];
  readonly usage?: PortLogRuntimeUsage;
  readonly sourceUnchanged: boolean;
  readonly error?: string;
};

function argumentValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || undefined;
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("-") ? value : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hashFile(filePath: string): string {
  return Crypto.createHash("sha256").update(FS.readFileSync(filePath)).digest("hex");
}

function hashDirectory(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const visit = (directory: string, prefix: string) => {
    for (const entry of FS.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? Path.join(prefix, entry.name) : entry.name;
      const absolutePath = Path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else if (entry.isFile()) hashes[relativePath.replaceAll(Path.sep, "/")] = hashFile(absolutePath);
    }
  };
  visit(root, "");
  return hashes;
}

function sameHashes(before: Record<string, string>, after: Record<string, string>): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

function expectedWitnessIds(inputRoot: string): string[] {
  const graph = JSON.parse(FS.readFileSync(Path.join(inputRoot, "graph_facts.json"), "utf8")) as {
    facts?: { nodes?: Array<{ node_id?: unknown; attributes?: Record<string, unknown> }> };
  };
  return (graph.facts?.nodes ?? [])
    .filter((node) => {
      const attributes = JSON.stringify(node.attributes ?? {}).toLowerCase();
      return attributes.includes("centrifugalpump");
    })
    .map((node) => node.node_id)
    .filter((id): id is string => typeof id === "string")
    .sort();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function createPrompt(instruction: string): string {
  return instruction
    .replaceAll("/input", "input")
    .replaceAll("/workspace", "workspace")
    .concat(
      "\n\nThe project root contains the read-only input/ directory and writable workspace/ directory. Do not modify anything under input/. NetworkX may not be installed; use the canonical graph_facts.json with standard-library JSON when needed.",
    );
}

async function prepareRun(taskRoot: string): Promise<{
  readonly root: string;
  readonly inputRoot: string;
  readonly workspaceRoot: string;
}> {
  const sourceInputRoot = Path.join(taskRoot, "environment");
  const root = await FS.promises.mkdtemp(Path.join(OS.tmpdir(), "portlog-dexpi-baseline-"));
  const inputRoot = Path.join(root, "input");
  const workspaceRoot = Path.join(root, "workspace");
  await FS.promises.cp(sourceInputRoot, inputRoot, { recursive: true });
  await FS.promises.mkdir(workspaceRoot);
  return { root, inputRoot, workspaceRoot };
}

async function waitForCompletion(
  client: RuntimeClient,
  events: PortLogRuntimeEvent[],
  turnId: string,
): Promise<Extract<PortLogRuntimeEvent, { type: "turn.completed" }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("timed out waiting for turn.completed"));
    }, TURN_TIMEOUT_MS);
    const unsubscribe = client.onEvent((event) => {
      events.push(event);
      if (event.turnId !== turnId || event.type !== "turn.completed") return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

async function runOnce(input: {
  readonly run: number;
  readonly key: string;
  readonly taskRoot: string;
  readonly modelRef: string;
}): Promise<RunResult> {
  const sourceInputRoot = Path.join(input.taskRoot, "environment");
  const sourceBeforeHashes = hashDirectory(sourceInputRoot);
  const prepared = await prepareRun(input.taskRoot);
  const beforeHashes = hashDirectory(prepared.inputRoot);
  const startedAt = Date.now();
  const client = new RuntimeClient(input.key, Path.join(prepared.root, "runtime"), prepared.root);
  const events: PortLogRuntimeEvent[] = [];
  try {
    await client.request("runtime.initialize", {
      supportedProtocolVersions: [1],
      clientVersion: "dexpi-baseline",
    });
    const models = await client.request<ReadonlyArray<{ ref: string; status: string }>>("model.list", {});
    const model = models.find((candidate) => candidate.ref === input.modelRef);
    if (model?.status !== "ready") throw new Error(`model is not ready (${model?.status ?? "missing"})`);
    const project = await client.request<{ projectId: string }>("project.open", { root: prepared.root });
    const session = await client.request<{ sessionId: string }>("session.create", {
      projectId: project.projectId,
      modelRef: input.modelRef,
      thinkingLevel: "low",
    });
    const turnId = Crypto.randomUUID();
    const completion = waitForCompletion(client, events, turnId);
    const instruction = FS.readFileSync(Path.join(input.taskRoot, "instruction.md"), "utf8");
    await client.request("turn.send", {
      sessionId: session.sessionId,
      turnId,
      modelRef: input.modelRef,
      thinkingLevel: "low",
      text: createPrompt(instruction),
    });
    const finished = await completion;
    if (finished.state !== "completed") throw new Error(finished.errorMessage ?? `turn ${finished.state}`);

    const answerFile = Path.join(prepared.root, ANSWER_PATH);
    if (!FS.existsSync(answerFile)) throw new Error(`missing ${ANSWER_PATH}`);
    const answer = JSON.parse(FS.readFileSync(answerFile, "utf8")) as {
      verdict?: unknown;
      posture?: unknown;
      witness_ids?: unknown;
    };
    const expected = expectedWitnessIds(prepared.inputRoot);
    const witnesses = Array.isArray(answer.witness_ids)
      ? answer.witness_ids.filter((id): id is string => typeof id === "string").sort()
      : [];
    const knownWitnesses = new Set(expected);
    const unsupportedWitnessIds = witnesses.filter((id) => !knownWitnesses.has(id));
    const matchedWitnesses = witnesses.filter((id) => knownWitnesses.has(id));
    const coverage = expected.length === 0 ? 1 : matchedWitnesses.length / expected.length;
    const success =
      answer.verdict === (expected.length > 0 ? "violation_found" : "no_violation") &&
      answer.posture === "source_grounded" &&
      sameStringSet(witnesses, expected) &&
      unsupportedWitnessIds.length === 0;
    const answerVerdict = typeof answer.verdict === "string" ? answer.verdict : undefined;
    const afterHashes = hashDirectory(prepared.inputRoot);
    const sourceUnchanged =
      sameHashes(beforeHashes, afterHashes) && sameHashes(sourceBeforeHashes, hashDirectory(sourceInputRoot));
    return {
      run: input.run,
      success,
      durationMs: Date.now() - startedAt,
      toolCalls: events.filter((event) => event.type === "tool.started").length,
      toolNames: events
        .filter((event): event is Extract<PortLogRuntimeEvent, { type: "tool.started" }> => event.type === "tool.started")
        .map((event) => event.toolName),
      userInterventions: 0,
      ...(answerVerdict ? { verdict: answerVerdict } : {}),
      witnessIds: witnesses,
      witnessCoverage: coverage,
      unsupportedWitnessIds,
      ...(finished.usage ? { usage: finished.usage } : {}),
      sourceUnchanged,
      ...(success ? {} : { error: "structured answer did not match the source-grounded oracle" }),
    };
  } catch (error) {
    return {
      run: input.run,
      success: false,
      durationMs: Date.now() - startedAt,
      toolCalls: events.filter((event) => event.type === "tool.started").length,
      toolNames: events
        .filter((event): event is Extract<PortLogRuntimeEvent, { type: "tool.started" }> => event.type === "tool.started")
        .map((event) => event.toolName),
      userInterventions: 0,
      sourceUnchanged:
        sameHashes(beforeHashes, hashDirectory(prepared.inputRoot)) &&
        sameHashes(sourceBeforeHashes, hashDirectory(sourceInputRoot)),
      error: redact(error instanceof Error ? error.message : String(error), input.key),
    };
  } finally {
    await client.shutdown();
    client.forceKill();
    await FS.promises.rm(prepared.root, { recursive: true, force: true });
  }
}

function resolveTaskRoot(fixtureDir: string): string {
  const candidates = [fixtureDir, Path.dirname(fixtureDir)];
  const tasksRoot = Path.join(fixtureDir, "tasks");
  if (FS.existsSync(tasksRoot)) {
    for (const entry of FS.readdirSync(tasksRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(Path.join(tasksRoot, entry.name));
    }
  }
  const taskRoot = candidates.find(
    (candidate) =>
      FS.existsSync(Path.join(candidate, "instruction.md")) &&
      FS.existsSync(Path.join(candidate, "environment", "graph_facts.json")),
  );
  if (!taskRoot) {
    throw new Error(
      `fixture must contain instruction.md and environment/graph_facts.json: ${fixtureDir}`,
    );
  }
  return taskRoot;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fixtureArgument = argumentValue(args, "--fixture-dir");
  if (!fixtureArgument) throw new Error("--fixture-dir is required");
  const fixtureDir = Path.resolve(fixtureArgument);
  const taskRoot = resolveTaskRoot(fixtureDir);
  const modelRef = argumentValue(args, "--model-ref") ?? DEFAULT_MODEL_REF;
  const runs = parsePositiveInt(argumentValue(args, "--runs"), DEFAULT_RUNS);
  const outputPath = Path.resolve(argumentValue(args, "--output") ?? ".tmp/portlog-baseline/latest.json");
  const key =
    process.env.PORTLOG_OPENROUTER_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    (await readSecret("OpenRouter API key (hidden): "));
  if (!key) throw new Error("an OpenRouter API key is required");
  for (const required of ["instruction.md", "environment/drawing.xml", "environment/graph_facts.json"]) {
    if (!FS.existsSync(Path.join(taskRoot, required))) throw new Error(`fixture is missing ${required}`);
  }

  const results: RunResult[] = [];
  for (let run = 1; run <= runs; run += 1) {
    const result = await runOnce({ run, key, taskRoot, modelRef });
    results.push(result);
    console.log(`run ${run}/${runs}: ${result.success ? "PASS" : "FAIL"} tools=${result.toolCalls} duration_ms=${result.durationMs}`);
  }
  const durations = results.map((result) => result.durationMs);
  const successful = results.filter((result) => result.success).length;
  const baseline = {
    schemaVersion: 1,
    runtime: {
      protocolVersion: 1,
      piVersion: "0.81.1",
      entry: "apps/portlog-runtime/dist/index.mjs",
    },
    sourceFixture: taskRoot,
    modelRef,
    thinkingLevel: "low",
    toolPolicy: [...PORTLOG_TOOL_POLICY],
    prompt: {
      source: "instruction.md",
      sha256: hashFile(Path.join(taskRoot, "instruction.md")),
      remapping: { "/input": "input", "/workspace": "workspace" },
    },
    runs: results,
    summary: {
      successRate: successful / results.length,
      sourceUnchanged: results.every((result) => result.sourceUnchanged),
      durationMs: {
        min: Math.min(...durations),
        max: Math.max(...durations),
        mean: durations.reduce((sum, value) => sum + value, 0) / durations.length,
      },
      repeatedRunVariance: new Set(results.map((result) => `${result.success}:${result.toolCalls}`)).size,
      unsupportedClaims: results.reduce(
        (count, result) => count + (result.unsupportedWitnessIds?.length ?? 0),
        0,
      ),
      userInterventions: results.reduce((sum, result) => sum + result.userInterventions, 0),
      usage: {
        inputTokens: results.reduce((sum, result) => sum + (result.usage?.inputTokens ?? 0), 0),
        outputTokens: results.reduce((sum, result) => sum + (result.usage?.outputTokens ?? 0), 0),
        totalTokens: results.reduce((sum, result) => sum + (result.usage?.totalTokens ?? 0), 0),
        cost: results.reduce((sum, result) => sum + (result.usage?.cost ?? 0), 0),
      },
    },
  };
  await FS.promises.mkdir(Path.dirname(outputPath), { recursive: true });
  await FS.promises.writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`baseline: ${successful}/${results.length} passed; wrote ${outputPath}`);
  if (successful !== results.length || !baseline.summary.sourceUnchanged) process.exitCode = 1;
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(`FAIL DEXPI baseline: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
