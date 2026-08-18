/**
 * OpenAICompatibleAdapterLive - Host-owned BYOK OpenAI-compatible chat adapter.
 *
 * Credentials come from ProviderCredentials (server secret store), not Pi
 * auth.json / vendor CLIs. Emits the same runtime event shapes as other
 * adapters so Studio transcript chrome works without a coding-agent harness.
 *
 * @module OpenAICompatibleAdapterLive
 */
import {
  DEFAULT_RUNTIME_MODE,
  EventId,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ModelSelection,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
} from "@synara/contracts";
import { Effect, Layer, Option, Queue, Stream } from "effect";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ServerConfig } from "../../config";
import { ProviderCredentials } from "../../providerCredentials";
import { ServerSecretStore } from "../../auth/Services/ServerSecretStore";
import { ServerSettingsService } from "../../serverSettings";
import { byokCatalogProvider } from "../../byok/byokCatalog.ts";
import {
  envValueForProvider,
} from "../../byok/byokConnectionRegistry.ts";
import { resolveProviderCredential } from "../../byok/providerConnection.ts";
import {
  collectSecretCandidates,
  parseSecretsFile,
  protectSecrets,
  type SecretProtectionMode,
} from "../../secrets/secretProtection.ts";
import { loadSecretProtectionKey } from "../../secrets/secretProtectionKey.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";
import { PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY } from "../Services/ProviderAdapter.ts";
import {
  OpenAICompatibleAdapter,
  type OpenAICompatibleAdapterShape,
} from "../Services/OpenAICompatibleAdapter.ts";
import { streamOpenAICompatibleChat } from "../openaiCompatibleClient.ts";
import {
  streamAiSdkChat,
  usesAiSdkChatPath,
} from "../aiSdkChatClient.ts";
import { makeWorkspaceTools } from "../workspaceTools.ts";

const PROVIDER = "openaiCompatible" as const;

type SecretProtectionConfig = {
  readonly mode: SecretProtectionMode;
  readonly key: Uint8Array;
  readonly candidates: ReadonlyArray<import("../../secrets/secretProtection.ts").SecretCandidate>;
};

type SessionContext = {
  readonly session: ProviderSession;
  modelSelection: ModelSelection | undefined;
  readonly messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  activeTurnId: TurnId | undefined;
  abortController: AbortController | undefined;
};

function makeEventBase(context: SessionContext, turnId?: TurnId) {
  return {
    eventId: EventId.makeUnsafe(crypto.randomUUID()),
    provider: PROVIDER,
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    ...(turnId ? { turnId } : context.activeTurnId ? { turnId: context.activeTurnId } : {}),
  };
}

const makeOpenAICompatibleAdapter = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const credentials = yield* ProviderCredentials;
  const secretStore = yield* Effect.serviceOption(ServerSecretStore);
  const settingsService = yield* ServerSettingsService;
  const runtimeEventQueue = yield* Queue.bounded<ProviderRuntimeEvent>(
    PROVIDER_ADAPTER_RUNTIME_EVENT_BUFFER_CAPACITY,
  );
  const sessions = new Map<ThreadId, SessionContext>();

  const offer = (event: ProviderRuntimeEvent) => {
    Effect.runFork(Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid));
  };

  const requireSession = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const context = sessions.get(threadId);
      if (!context) {
        return yield* Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session",
            detail: `No openaiCompatible session for thread ${String(threadId)}.`,
          }),
        );
      }
      return context;
    });

  const resolveConfig = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
    const providerSettings = settings.providers.openaiCompatible;
    const secretFiles =
      settings.secretProtectionMode === "off"
        ? {}
        : yield* Effect.promise(async () => {
            const contents = await Promise.all(
              [join(serverConfig.homeDir, "secrets.yml"), join(serverConfig.cwd, "secrets.yml")].map(
                (filePath) => readFile(filePath, "utf8").catch(() => ""),
              ),
            );
            return contents.map(parseSecretsFile).reduce<Record<string, string>>(
              (merged, values) => Object.assign(merged, values),
              {},
            );
          });
    const configuredProviders =
      settings.secretProtectionMode === "off"
        ? []
        : yield* credentials.listConfiguredByokProviders().pipe(Effect.orDie);
    const storedCredentials =
      settings.secretProtectionMode === "off"
        ? []
        : yield* Effect.forEach(configuredProviders, (provider) =>
            credentials.getByokApiKey(provider).pipe(
              Effect.map((value) => (value ? { provider, value } : null)),
              Effect.catch(() => Effect.succeed(null)),
            ),
          );
    const secretKey =
      settings.secretProtectionMode === "off"
        ? null
        : yield* loadSecretProtectionKey(Option.getOrUndefined(secretStore)).pipe(Effect.orDie);
    if (secretKey?.warning) yield* Effect.logWarning(secretKey.warning);
    const secretProtection: SecretProtectionConfig | null =
      settings.secretProtectionMode === "off"
        ? null
        : {
            mode: settings.secretProtectionMode,
            key: secretKey!.key,
            candidates: collectSecretCandidates({
              environment: process.env,
              secretsFile: secretFiles,
              credentials: storedCredentials.filter(
                (entry): entry is { readonly provider: string; readonly value: string } => entry !== null,
              ),
            }),
          };
    const catalogProviderId = providerSettings.catalogProviderId.trim() || "openrouter";
    const storedKey = yield* credentials.getByokApiKey(catalogProviderId).pipe(Effect.orDie);
    const credential = resolveProviderCredential({
      storedKey,
      envValue: envValueForProvider(catalogProviderId),
    });
    if (!credential && !byokCatalogProvider(catalogProviderId)?.is_local) {
      return yield* Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "credentials",
          detail: `BYOK API key is not configured for ${catalogProviderId}. Sign in from the model picker.`,
        }),
      );
    }
    const catalogued = byokCatalogProvider(catalogProviderId);
    const baseUrl =
      providerSettings.baseUrl.trim() ||
      catalogued?.base_url ||
      "https://openrouter.ai/api/v1";
    const defaultModel =
      providerSettings.defaultModel.trim() ||
      catalogued?.models[0]?.id ||
      "openai/gpt-4o";
    return {
      apiKey: credential?.apiKey ?? "",
      baseUrl,
      defaultModel,
      customModels: providerSettings.customModels,
      catalogProviderId,
      wire: catalogued?.wire ?? "openai",
      secretProtection,
    };
  });

  const startSession: OpenAICompatibleAdapterShape["startSession"] = (input) =>
    Effect.gen(function* () {
      yield* resolveConfig;
      const now = new Date().toISOString();
      const session: ProviderSession = {
        provider: PROVIDER,
        threadId: input.threadId,
        status: "ready",
        runtimeMode: input.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        createdAt: now,
        updatedAt: now,
        ...(input.cwd ? { cwd: input.cwd } : { cwd: serverConfig.cwd }),
        ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
      };
      sessions.set(input.threadId, {
        session,
        modelSelection: input.modelSelection,
        messages: [],
        activeTurnId: undefined,
        abortController: undefined,
      });
      offer({
        ...makeEventBase({
          session,
          modelSelection: input.modelSelection,
          messages: [],
          activeTurnId: undefined,
          abortController: undefined,
        }),
        type: "session.started",
        payload: { message: "BYOK OpenAI-compatible session ready" },
      } satisfies ProviderRuntimeEvent);
      return session;
    });

  const sendTurn: OpenAICompatibleAdapterShape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      const config = yield* resolveConfig;
      const model =
        input.modelSelection?.model?.trim() ||
        context.modelSelection?.model?.trim() ||
        context.session.model?.trim() ||
        config.defaultModel;
      const userText = input.input?.trim() ?? "";
      if (!userText) {
        return yield* Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/start",
            detail: "BYOK turn requires non-empty input.",
          }),
        );
      }

      const turnId = TurnId.makeUnsafe(crypto.randomUUID());
      context.activeTurnId = turnId;
      context.messages.push({ role: "user", content: userText });
      const abortController = new AbortController();
      context.abortController = abortController;

      offer({
        ...makeEventBase(context, turnId),
        type: "turn.started",
        payload: { model },
      } satisfies ProviderRuntimeEvent);

      const itemId = RuntimeItemId.makeUnsafe(`byok-assistant-${crypto.randomUUID()}`);
      offer({
        ...makeEventBase(context, turnId),
        itemId,
        type: "item.started",
        payload: { itemType: "assistant_message", status: "inProgress", title: "Assistant" },
      } satisfies ProviderRuntimeEvent);

      const messagesForModel = config.secretProtection
        ? context.messages.map((message) => {
            const protectedMessage = protectSecrets({
              text: message.content,
              mode: config.secretProtection!.mode,
              key: config.secretProtection!.key,
              candidates: config.secretProtection!.candidates,
            });
            if (protectedMessage.audit.length > 0) {
              Effect.runFork(
                Effect.logInfo("secret obfuscation applied", {
                  count: protectedMessage.audit.length,
                  outcomes: protectedMessage.audit.map((entry) => entry.outcome),
                }),
              );
            }
            return { ...message, content: protectedMessage.text };
          })
        : context.messages;

      const run = Effect.tryPromise({
        try: async () => {
          const onTextDelta = (delta: string) => {
            offer({
              ...makeEventBase(context, turnId),
              itemId,
              type: "content.delta",
              payload: {
                streamKind: "assistant_text",
                delta,
                contentIndex: 0,
              },
            } satisfies ProviderRuntimeEvent);
          };

          const toolItemIds = new Map<string, RuntimeItemId>();
          const offerToolCall = (call: {
            readonly toolCallId: string;
            readonly toolName: string;
            readonly input: unknown;
          }) => {
            const toolItemId = RuntimeItemId.makeUnsafe(
              `byok-tool-${call.toolCallId || crypto.randomUUID()}`,
            );
            toolItemIds.set(call.toolCallId, toolItemId);
            offer({
              ...makeEventBase(context, turnId),
              itemId: toolItemId,
              type: "item.started",
              payload: {
                itemType: "dynamic_tool_call",
                status: "inProgress",
                title: call.toolName,
              },
            } satisfies ProviderRuntimeEvent);
          };
          const offerToolResult = (result: {
            readonly toolCallId: string;
            readonly toolName: string;
            readonly output: unknown;
          }) => {
            const toolItemId = toolItemIds.get(result.toolCallId);
            if (!toolItemId) return;
            offer({
              ...makeEventBase(context, turnId),
              itemId: toolItemId,
              type: "item.completed",
              payload: {
                itemType: "dynamic_tool_call",
                status: "completed",
                title: result.toolName,
                detail: typeof result.output === "string" ? result.output.slice(0, 2_000) : undefined,
              },
            } satisfies ProviderRuntimeEvent);
          };
          const offerToolError = (failure: {
            readonly toolCallId: string;
            readonly toolName: string;
            readonly error: unknown;
          }) => {
            const toolItemId = toolItemIds.get(failure.toolCallId);
            if (!toolItemId) return;
            const message = failure.error instanceof Error ? failure.error.message : String(failure.error);
            offer({
              ...makeEventBase(context, turnId),
              itemId: toolItemId,
              type: "item.completed",
              payload: {
                itemType: "dynamic_tool_call",
                status: "failed",
                title: failure.toolName,
                detail: message.slice(0, 2_000),
              },
            } satisfies ProviderRuntimeEvent);
          };

          const fullText = usesAiSdkChatPath(config.catalogProviderId)
            ? await streamAiSdkChat(
                {
                  provider:
                    config.catalogProviderId === "vercel-ai-gateway"
                      ? "vercel-ai-gateway"
                      : "openrouter",
                  apiKey: config.apiKey,
                  model,
                  messages: messagesForModel,
                  baseUrl: config.baseUrl,
                  tools: makeWorkspaceTools(context.session.cwd ?? serverConfig.cwd),
                  signal: abortController.signal,
                },
                {
                  onTextDelta,
                  onToolCall: offerToolCall,
                  onToolResult: offerToolResult,
                  onToolError: offerToolError,
                },
              )
            : await streamOpenAICompatibleChat(
                {
                  baseUrl: config.baseUrl,
                  apiKey: config.apiKey,
                  model,
                  messages: messagesForModel,
                  signal: abortController.signal,
                },
                { onTextDelta },
              );
          context.messages.push({ role: "assistant", content: fullText });
          offer({
            ...makeEventBase(context, turnId),
            itemId,
            type: "item.completed",
            payload: { itemType: "assistant_message", status: "completed", title: "Assistant" },
          } satisfies ProviderRuntimeEvent);
          offer({
            ...makeEventBase(context, turnId),
            type: "turn.completed",
            payload: { state: "completed", stopReason: null },
          } satisfies ProviderRuntimeEvent);
          context.activeTurnId = undefined;
          context.abortController = undefined;
        },
        catch: (cause) => {
          const message =
            cause instanceof Error ? cause.message : "BYOK OpenAI-compatible turn failed.";
          offer({
            ...makeEventBase(context, turnId),
            type: "runtime.error",
            payload: { message, class: "provider_error" },
          } satisfies ProviderRuntimeEvent);
          offer({
            ...makeEventBase(context, turnId),
            type: "turn.completed",
            payload: {
              state: "failed",
              stopReason: null,
              errorMessage: message,
            },
          } satisfies ProviderRuntimeEvent);
          context.activeTurnId = undefined;
          context.abortController = undefined;
          return new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/start",
            detail: message,
            cause,
          });
        },
      });

      // Fork the network work so sendTurn can return the turn id immediately.
      Effect.runFork(run.pipe(Effect.ignore));

      return {
        threadId: input.threadId,
        turnId,
      } satisfies ProviderTurnStartResult;
    });

  const interruptTurn: OpenAICompatibleAdapterShape["interruptTurn"] = (threadId) =>
    Effect.sync(() => {
      const context = sessions.get(threadId);
      context?.abortController?.abort();
    });

  const respondToRequest: OpenAICompatibleAdapterShape["respondToRequest"] = () => Effect.void;
  const respondToUserInput: OpenAICompatibleAdapterShape["respondToUserInput"] = () => Effect.void;

  const stopSession: OpenAICompatibleAdapterShape["stopSession"] = (threadId) =>
    Effect.sync(() => {
      const context = sessions.get(threadId);
      context?.abortController?.abort();
      sessions.delete(threadId);
    });

  const listSessions: OpenAICompatibleAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(sessions.values()).map((entry) => entry.session));

  const hasSession: OpenAICompatibleAdapterShape["hasSession"] = (threadId) =>
    Effect.succeed(sessions.has(threadId));

  const readThread: OpenAICompatibleAdapterShape["readThread"] = (threadId) =>
    Effect.succeed({
      threadId,
      turns: [],
    });

  const rollbackThread: OpenAICompatibleAdapterShape["rollbackThread"] = (threadId) =>
    Effect.succeed({
      threadId,
      turns: [],
    });

  const stopAll: OpenAICompatibleAdapterShape["stopAll"] = () =>
    Effect.sync(() => {
      for (const context of sessions.values()) {
        context.abortController?.abort();
      }
      sessions.clear();
    });

  const listModels: NonNullable<OpenAICompatibleAdapterShape["listModels"]> = () =>
    Effect.gen(function* () {
      const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
      const providerSettings = settings.providers.openaiCompatible;
      const catalogued = byokCatalogProvider(providerSettings.catalogProviderId);
      const catalogModels = (catalogued?.models ?? []).map((model) => ({
        slug: model.id,
        name: model.name,
      }));
      const settingsModels = [
        providerSettings.defaultModel,
        ...providerSettings.customModels,
      ]
        .map((model) => model.trim())
        .filter(Boolean)
        .map((slug) => ({ slug, name: slug }));
      const seen = new Set<string>();
      const models = [...catalogModels, ...settingsModels].filter((model) => {
        if (seen.has(model.slug)) return false;
        seen.add(model.slug);
        return true;
      });
      return {
        models,
        source: catalogued ? "byok.models.dev" : "openaiCompatible.settings",
        cached: false,
      };
    });

  const getComposerCapabilities: NonNullable<
    OpenAICompatibleAdapterShape["getComposerCapabilities"]
  > = () =>
    Effect.succeed({
      provider: PROVIDER,
      supportsSkillMentions: false,
      supportsSkillDiscovery: false,
      supportsNativeSlashCommandDiscovery: false,
      supportsPluginMentions: false,
      supportsPluginDiscovery: false,
      supportsRuntimeModelList: true,
      supportsThreadCompaction: false,
      supportsThreadImport: false,
    });

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
      conversationRollback: "restart-session",
      supportsRuntimeModelList: true,
      supportsTurnSteering: false,
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    listModels,
    getComposerCapabilities,
    streamEvents: Stream.fromQueue(runtimeEventQueue),
  } satisfies OpenAICompatibleAdapterShape;
});

export const OpenAICompatibleAdapterLive = Layer.effect(
  OpenAICompatibleAdapter,
  makeOpenAICompatibleAdapter,
);

export function makeOpenAICompatibleAdapterLive() {
  return OpenAICompatibleAdapterLive;
}
