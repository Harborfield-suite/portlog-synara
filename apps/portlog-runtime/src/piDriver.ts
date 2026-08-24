import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  InMemoryCredentialStore,
  clampThinkingLevel,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type {
  PortLogRuntimeEvent,
  PortLogRuntimeModel,
} from "@synara/contracts";

import { translatePiEvent } from "./piEventTranslator";
import { PORTLOG_TOOL_POLICY, sanitizeBashEnvironment } from "./toolPolicy";

export { PORTLOG_TOOL_POLICY, sanitizeBashEnvironment } from "./toolPolicy";

const MODEL_CANDIDATES = [
  {
    ref: "openrouter/deepseek/deepseek-v4-flash",
    providerId: "openrouter",
    modelId: "deepseek/deepseek-v4-flash",
    providerLabel: "OpenRouter",
    modelLabel: "DeepSeek V4 Flash",
  },
  {
    ref: "openai-codex/gpt-5.4",
    providerId: "openai-codex",
    modelId: "gpt-5.4",
    providerLabel: "OpenAI OAuth",
    modelLabel: "GPT-5.4",
  },
] as const;

const PORTLOG_SYSTEM_PROMPT = [
  "You are PortLog, an editor-first process-engineering workspace.",
  "Use the available workspace tools directly and keep claims grounded in project evidence.",
  "Do not claim a deterministic result when the project evidence is insufficient.",
].join(" ");

type PiEventListener = (sessionId: string, event: PortLogRuntimeEvent) => void;

type SessionRecord = {
  readonly sessionId: string;
  readonly streamId: string;
  readonly session: AgentSession;
  activeTurnId: string | null;
  cancelled: boolean;
  unsubscribe: () => void;
};

export interface PiDriverOptions {
  readonly dataDir: string;
  readonly onEvent: PiEventListener;
}

export interface PiSessionCreateInput {
  readonly sessionId: string;
  readonly cwd: string;
  readonly modelRef: string;
  readonly thinkingLevel: string;
  readonly piSessionFile?: string;
}

export interface PiSessionCreateResult {
  readonly thinkingLevel: string;
  readonly piSessionFile: string;
}

type PortLogPiTool = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: any;
  readonly execute: (...args: any[]) => Promise<any>;
};

function toToolDefinition(tool: PortLogPiTool): ToolDefinition<any> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate),
  };
}

export class PiDriver {
  private readonly dataDir: string;
  private readonly onEvent: PiEventListener;
  private readonly credentials = new InMemoryCredentialStore();
  private readonly sessions = new Map<string, SessionRecord>();
  private modelRuntime: ModelRuntime | null = null;

  constructor(options: PiDriverOptions) {
    this.dataDir = options.dataDir;
    this.onEvent = options.onEvent;
  }

  async initialize(): Promise<void> {
    FS.mkdirSync(Path.join(this.dataDir, "pi"), { recursive: true });
    const openRouterKey = process.env.PORTLOG_OPENROUTER_API_KEY?.trim();
    const openAiKey = process.env.PORTLOG_OPENAI_API_KEY?.trim();
    if (openRouterKey) {
      await this.credentials.modify("openrouter", async () => ({
        type: "api_key",
        key: openRouterKey,
      }));
    }
    if (openAiKey) {
      await this.credentials.modify("openai", async () => ({
        type: "api_key",
        key: openAiKey,
      }));
    }

    this.modelRuntime = await ModelRuntime.create({
      credentials: this.credentials,
      modelsPath: null,
      modelsStorePath: Path.join(this.dataDir, "pi", "models-store.json"),
      allowModelNetwork: false,
    });
  }

  async listModels(): Promise<ReadonlyArray<PortLogRuntimeModel>> {
    const runtime = this.requireModelRuntime();
    return Promise.all(
      MODEL_CANDIDATES.map(async (candidate) => {
        const model = runtime.getModel(candidate.providerId, candidate.modelId);
        const auth = await runtime.checkAuth(candidate.providerId).catch(() => undefined);
        if (!model) {
          return {
            ref: candidate.ref,
            providerId: candidate.providerId,
            providerLabel: candidate.providerLabel,
            modelLabel: candidate.modelLabel,
            status: "unavailable" as const,
          };
        }
        const thinkingLevels = model.thinkingLevelMap
          ? Object.entries(model.thinkingLevelMap)
              .filter(([, value]) => value !== null)
              .map(([level]) => level)
          : [];
        return {
          ref: candidate.ref,
          providerId: candidate.providerId,
          providerLabel: candidate.providerLabel,
          modelLabel: candidate.modelLabel,
          status: auth ? ("ready" as const) : ("needs_auth" as const),
          contextWindow: model.contextWindow,
          reasoning: model.reasoning,
          ...(thinkingLevels.length > 0 ? { thinkingLevels } : {}),
        };
      }),
    );
  }

  async createSession(input: PiSessionCreateInput): Promise<PiSessionCreateResult> {
    if (this.sessions.has(input.sessionId)) {
      const existing = this.sessions.get(input.sessionId);
      return {
        thinkingLevel: existing?.session.thinkingLevel ?? input.thinkingLevel,
        piSessionFile: existing?.session.sessionFile ?? "",
      };
    }
    const runtime = this.requireModelRuntime();
    const model = this.resolveModel(runtime, input.modelRef);
    const thinkingLevel = clampThinkingLevel(model, input.thinkingLevel as ModelThinkingLevel);
    const agentDir = Path.join(this.dataDir, "pi");
    const sessionDir = Path.join(this.dataDir, "sessions");
    FS.mkdirSync(sessionDir, { recursive: true });
    const settingsManager = SettingsManager.inMemory(
      { defaultThinkingLevel: thinkingLevel },
      { projectTrusted: true },
    );
    const resourceLoader = new DefaultResourceLoader({
      cwd: input.cwd,
      agentDir,
      settingsManager,
      systemPrompt: PORTLOG_SYSTEM_PROMPT,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const sessionManager = input.piSessionFile && FS.existsSync(input.piSessionFile)
      ? SessionManager.open(input.piSessionFile, sessionDir, input.cwd)
      : SessionManager.create(input.cwd, sessionDir, { id: input.sessionId });
    const tools = {
      read: createReadTool(input.cwd),
      write: createWriteTool(input.cwd),
      edit: createEditTool(input.cwd),
      bash: createBashTool(input.cwd, { spawnHook: sanitizeBashEnvironment }),
    };
    const { session } = await createAgentSession({
      cwd: input.cwd,
      agentDir,
      modelRuntime: runtime,
      model,
      thinkingLevel,
      tools: [...PORTLOG_TOOL_POLICY],
      customTools: Object.values(tools).map(toToolDefinition),
      resourceLoader,
      sessionManager,
      settingsManager,
    });
    const record: SessionRecord = {
      sessionId: input.sessionId,
      streamId: Crypto.randomUUID(),
      session,
      activeTurnId: null,
      cancelled: false,
      unsubscribe: () => undefined,
    };
    record.unsubscribe = session.subscribe((event) => {
      const turnId = record.activeTurnId;
      const stats = event.type === "agent_end" ? record.session.getSessionStats() : undefined;
      const translated = translatePiEvent(
        event,
        turnId
          ? {
              streamId: record.streamId,
              cursor: 0,
              sessionId: record.sessionId,
              turnId,
            }
          : {
              streamId: record.streamId,
              cursor: 0,
              sessionId: record.sessionId,
            },
        event.type === "agent_end" ? record.session.agent.state.errorMessage : undefined,
        record.cancelled,
        stats
          ? {
              inputTokens: stats.tokens.input,
              outputTokens: stats.tokens.output,
              cacheReadTokens: stats.tokens.cacheRead,
              cacheWriteTokens: stats.tokens.cacheWrite,
              totalTokens: stats.tokens.total,
              cost: stats.cost,
            }
          : undefined,
      );
      for (const eventValue of translated) this.onEvent(record.sessionId, eventValue);
      if (event.type === "agent_end") {
        record.activeTurnId = null;
        record.cancelled = false;
      }
    });
    this.sessions.set(input.sessionId, record);
    return {
      thinkingLevel,
      piSessionFile: session.sessionFile ?? Path.join(sessionDir, `${input.sessionId}.jsonl`),
    };
  }

  isTurnActive(sessionId: string): boolean {
    return Boolean(this.requireSession(sessionId).activeTurnId);
  }

  getActiveTurnId(sessionId: string): string | null {
    return this.requireSession(sessionId).activeTurnId;
  }

  getStreamId(sessionId: string): string {
    return this.requireSession(sessionId).streamId;
  }

  getEffectiveThinkingLevel(modelRef: string, thinkingLevel: string): string {
    const model = this.resolveModel(this.requireModelRuntime(), modelRef);
    return clampThinkingLevel(model, thinkingLevel as ModelThinkingLevel);
  }

  async configureSession(sessionId: string, modelRef: string, thinkingLevel: string): Promise<string> {
    const record = this.requireSession(sessionId);
    const model = this.resolveModel(this.requireModelRuntime(), modelRef);
    const effectiveThinkingLevel = clampThinkingLevel(model, thinkingLevel as ModelThinkingLevel);
    await record.session.setModel(model);
    record.session.setThinkingLevel(effectiveThinkingLevel);
    return effectiveThinkingLevel;
  }

  async sendTurn(sessionId: string, turnId: string, text: string): Promise<void> {
    const record = this.requireSession(sessionId);
    if (record.activeTurnId) throw new Error("A turn is already active for this session.");
    record.activeTurnId = turnId;
    record.cancelled = false;
    try {
      await record.session.prompt(text);
    } catch (error) {
      if (record.activeTurnId !== turnId) return;
      this.emitError(record, turnId, error);
      record.activeTurnId = null;
    }
  }

  async cancelTurn(sessionId: string, turnId: string): Promise<void> {
    const record = this.requireSession(sessionId);
    if (record.activeTurnId !== turnId) return;
    record.cancelled = true;
    try {
      await record.session.abort();
    } finally {
      if (record.activeTurnId !== turnId) return;
      this.onEvent(record.sessionId, {
        streamId: record.streamId,
        cursor: 0,
        sessionId: record.sessionId,
        turnId,
        type: "turn.completed",
        state: "cancelled",
      });
      record.activeTurnId = null;
      record.cancelled = false;
    }
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(
      sessions.map(async (record) => {
        record.unsubscribe();
        await record.session.dispose();
      }),
    );
  }

  private resolveModel(runtime: ModelRuntime, modelRef: string): Model<any> {
    const separator = modelRef.indexOf("/");
    if (separator <= 0 || separator === modelRef.length - 1) {
      throw new Error(`Invalid PortLog model reference '${modelRef}'.`);
    }
    const providerId = modelRef.slice(0, separator);
    const modelId = modelRef.slice(separator + 1);
    const model = runtime.getModel(providerId, modelId);
    if (!model) throw new Error(`Model '${modelRef}' is unavailable.`);
    return model;
  }

  private requireModelRuntime(): ModelRuntime {
    if (!this.modelRuntime) throw new Error("Pi model runtime is not initialized.");
    return this.modelRuntime;
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Session '${sessionId}' was not found.`);
    return record;
  }

  private emitError(record: SessionRecord, turnId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.onEvent(record.sessionId, {
      streamId: record.streamId,
      cursor: 0,
      sessionId: record.sessionId,
      turnId,
      type: "runtime.error",
      code: "PI_RUNTIME_ERROR",
      message,
    });
    this.onEvent(record.sessionId, {
      streamId: record.streamId,
      cursor: 0,
      sessionId: record.sessionId,
      turnId,
      type: "turn.completed",
      state: "failed",
      errorMessage: message,
    });
  }
}
