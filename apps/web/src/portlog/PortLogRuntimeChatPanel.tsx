import {
  MODEL_OPTIONS_BY_PROVIDER,
  TurnId,
  type MessageId,
  type ModelSlug,
  type ProviderKind,
  type PortLogRuntimeEvent,
  type PortLogRuntimeEvidence,
  type PortLogRuntimeModel,
} from "@synara/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LegendListRef } from "@legendapp/list/react";

import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "../components/ComposerPromptEditor";
import type { TurnDiffSummary } from "../types";
import { ComposerColumnFrame } from "../components/chat/ComposerColumnFrame";
import { ChatTranscriptPane } from "../components/chat/ChatTranscriptPane";
import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import {
  COMPOSER_EDITOR_PADDING_CLASS_NAME,
  COMPOSER_FOOTER_ROW_CLASS_NAME,
  COMPOSER_INPUT_SHELL_CLASS_NAME,
  COMPOSER_INPUT_SURFACE_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import { DEFAULT_CHAT_FONT_SIZE_PX } from "../appSettings";
import type { ProviderModelOption } from "../providerModelOptions";
import { ComposerSendArrowIcon } from "../lib/icons";
import { Button } from "../components/ui/button";
import { getPortLogRuntimeClient, type PortLogRuntimeClient } from "./portlogRuntimeClient";
import { PortLogEvidenceInspector } from "./PortLogEvidenceInspector";
import {
  applyPortLogEvent,
  createPortLogChatState,
  portLogTimelineEntries,
} from "./portlogChatAdapter";

interface PortLogRuntimeChatPanelProps {
  readonly workspaceRoot: string | null;
  readonly onOpenEvidence: (evidenceId: string, sourcePath: string | null) => void;
}

const DEFAULT_MODEL: ModelSlug = "openrouter/deepseek/deepseek-v4-flash";
const EMPTY_REVERT_TURN_COUNTS: Map<MessageId, number> = new Map();
const EMPTY_TURN_DIFF_SUMMARIES: Map<MessageId, TurnDiffSummary> = new Map();
const NOOP = () => undefined;

function runtimeSessionStorageKey(workspaceRoot: string): string {
  return `portlog-runtime-session:${workspaceRoot}`;
}

function newId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function modelOptions(
  models: ReadonlyArray<PortLogRuntimeModel>,
): Record<ProviderKind, ReadonlyArray<ProviderModelOption>> {
  return {
    ...MODEL_OPTIONS_BY_PROVIDER,
    pi: models.map((model) => ({
      slug: model.ref,
      name: model.modelLabel,
      upstreamProviderId: model.providerId,
      upstreamProviderName: model.providerLabel,
    })),
  };
}

export function PortLogRuntimeChatPanel(props: PortLogRuntimeChatPanelProps) {
  const client = useMemo<PortLogRuntimeClient | null>(() => getPortLogRuntimeClient(), []);
  const [models, setModels] = useState<ReadonlyArray<PortLogRuntimeModel>>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSlug>(DEFAULT_MODEL);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [chatState, setChatState] = useState(createPortLogChatState);
  const [draft, setDraft] = useState("");
  const [composerCursor, setComposerCursor] = useState(0);
  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const [status, setStatus] = useState("Starting runtime…");
  const [error, setError] = useState<string | null>(null);
  const [followTranscript, setFollowTranscript] = useState(true);
  const [activeTurnStartedAt, setActiveTurnStartedAt] = useState<string | null>(null);
  const recoveryRef = useRef<{
    readonly sessionId: string;
    readonly pending: PortLogRuntimeEvent[];
    snapshotPending: boolean;
  } | null>(null);

  const options = useMemo(() => modelOptions(models), [models]);
  const selectedRuntimeModel = models.find((model) => model.ref === selectedModel) ?? null;
  const timelineEntries = useMemo(
    () => portLogTimelineEntries(chatState),
    [chatState],
  );
  const listRef = useRef<LegendListRef | null>(null);
  const canSend = Boolean(
    client &&
      props.workspaceRoot &&
      draft.trim() &&
      !activeTurnId &&
      selectedRuntimeModel?.status === "ready",
  );
  const modelNeedsAuth = selectedRuntimeModel?.status === "needs_auth";

  useEffect(() => {
    if (!client || !props.workspaceRoot) return;
    setChatState(createPortLogChatState());
    setFollowTranscript(true);
    setActiveTurnId(null);
    setActiveTurnStartedAt(null);
    const saved = localStorage.getItem(runtimeSessionStorageKey(props.workspaceRoot));
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { projectId?: unknown; sessionId?: unknown };
      if (typeof parsed.projectId !== "string" || typeof parsed.sessionId !== "string") return;
      setProjectId(parsed.projectId);
      setSessionId(parsed.sessionId);
      const recovery: {
        readonly sessionId: string;
        readonly pending: PortLogRuntimeEvent[];
        snapshotPending: boolean;
      } = {
        sessionId: parsed.sessionId,
        pending: [],
        snapshotPending: true,
      };
      recoveryRef.current = recovery;
      void client.attachSession({ sessionId: parsed.sessionId }).then(
        (snapshot) => {
          if (recoveryRef.current !== recovery) return;
          const installed = snapshot.events.reduce(
            applyPortLogEvent,
            createPortLogChatState(),
          );
          const pending = recovery.pending.filter(
            (event) => event.streamId === snapshot.streamId && event.cursor > snapshot.cursor,
          );
          const recovered = pending.reduce(applyPortLogEvent, installed);
          setChatState(recovered);
          setActiveTurnId(snapshot.activeTurnId ?? null);
          setActiveTurnStartedAt(
            snapshot.activeTurnId
              ? recovered.messages.find(
                  (message) =>
                    message.role === "user" && message.turnId === TurnId.makeUnsafe(snapshot.activeTurnId!),
                )?.createdAt ?? null
              : null,
          );
          if (snapshot.state === "interrupted") setStatus("Previous turn interrupted; review before continuing");
          recovery.snapshotPending = false;
          recoveryRef.current = null;
        },
        () => {
          if (recoveryRef.current === recovery) recoveryRef.current = null;
          localStorage.removeItem(runtimeSessionStorageKey(props.workspaceRoot!));
          setProjectId(null);
          setSessionId(null);
        },
      );
    } catch {
      localStorage.removeItem(runtimeSessionStorageKey(props.workspaceRoot!));
    }
  }, [client, props.workspaceRoot]);

  useEffect(() => {
    if (!client || !props.workspaceRoot || projectId) return;
    let active = true;
    void client.openProject({ root: props.workspaceRoot }).then(
      (project) => {
        if (!active) return;
        setProjectId(project.projectId);
        setStatus("Project ready");
      },
      (cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus("Project unavailable");
      },
    );
    return () => {
      active = false;
    };
  }, [client, projectId, props.workspaceRoot]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    void Promise.all([client.getStatus(), client.listModels()]).then(
      ([runtimeState, runtimeModels]) => {
        if (!active) return;
        setModels(runtimeModels);
        const firstReady = runtimeModels.find((model) => model.status === "ready");
        if (firstReady) setSelectedModel(firstReady.ref);
        setStatus(runtimeState.status === "ready" ? "Runtime ready" : "Runtime unavailable");
      },
      (cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus("Runtime unavailable");
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (!client) return;
    return client.onEvent((event) => {
      if (event.sessionId !== sessionId) return;
      const recovery = recoveryRef.current;
      if (recovery?.sessionId === event.sessionId && recovery.snapshotPending) {
        recovery.pending.push(event);
        return;
      }
      setChatState((previous) => applyPortLogEvent(previous, event));
      if (event.type === "user.message" && event.turnId === activeTurnId) {
        setActiveTurnStartedAt(event.createdAt);
      }
      if (event.type === "turn.completed") {
        setActiveTurnId(null);
        setActiveTurnStartedAt(null);
      }
    });
  }, [client, sessionId]);

  const send = async () => {
    if (!client || !props.workspaceRoot || !canSend) return;
    if (selectedRuntimeModel?.status !== "ready") {
      setError(
        modelNeedsAuth
          ? "OpenRouter credential is unavailable to this desktop process. Restart it from a shell with PORTLOG_OPENROUTER_API_KEY or OPENROUTER_API_KEY set."
          : "The selected model is unavailable.",
      );
      return;
    }
    const text = draft.trim();
    const turnId = newId("turn");
    setDraft("");
    setComposerCursor(0);
    setChatState((previous) =>
      applyPortLogEvent(previous, {
        streamId: `local:${turnId}`,
        cursor: 0,
        sessionId: sessionId ?? "pending",
        turnId,
        createdAt: new Date().toISOString(),
        type: "user.message",
        text,
      }),
    );
    setError(null);
    setActiveTurnId(turnId);
    setActiveTurnStartedAt(new Date().toISOString());

    try {
      let nextProjectId = projectId;
      if (!nextProjectId) {
        const project = await client.openProject({ root: props.workspaceRoot });
        nextProjectId = project.projectId;
        setProjectId(nextProjectId);
      }
      let nextSessionId = sessionId;
      if (!nextSessionId) {
        const session = await client.createSession({
          projectId: nextProjectId,
          modelRef: selectedModel,
          thinkingLevel: "low",
        });
        nextSessionId = session.sessionId;
        setSessionId(nextSessionId);
        localStorage.setItem(
          runtimeSessionStorageKey(props.workspaceRoot),
          JSON.stringify({ projectId: nextProjectId, sessionId: nextSessionId }),
        );
      }
      await client.sendTurn({
        sessionId: nextSessionId,
        turnId,
        text,
        modelRef: selectedModel,
        thinkingLevel: "low",
      });
    } catch (cause) {
      setActiveTurnId(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const cancel = async () => {
    if (!client || !sessionId || !activeTurnId) return;
    await client.cancelTurn({ sessionId, turnId: activeTurnId }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  useEffect(() => {
    if (!client || !sessionId || !activeTurnId) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void cancel();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [activeTurnId, client, sessionId]);

  const openEvidence = async (evidence: PortLogRuntimeEvidence) => {
    if (!client || !projectId) return;
    const artifact = evidence.artifactId
      ? await client.describeArtifact({ projectId, artifactId: evidence.artifactId }).catch(() => null)
      : null;
    props.onOpenEvidence(evidence.evidenceId, artifact?.relativePath ?? null);
  };

  const scrollToBottom = useCallback(() => {
    void listRef.current?.scrollToEnd?.({ animated: true });
  }, []);

  if (!client) {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">PortLog runtime is available in the desktop app.</div>;
  }

  return (
    <section
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background"
      aria-label="PortLog runtime chat"
      data-testid="portlog-runtime-chat"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/65 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            <span>PortLog runtime</span>
          </div>
          <div className="mt-0.5 max-w-full break-words text-[11px] leading-4 text-muted-foreground">
            {error ?? (modelNeedsAuth ? "Credential required for this model" : status)}
          </div>
        </div>
        <ProviderModelPicker
          provider="pi"
          model={selectedModel}
          lockedProvider="pi"
          modelOptionsByProvider={options}
          disabled={Boolean(activeTurnId || models.length === 0)}
          compact
          onProviderModelChange={(provider, model) => {
            if (provider === "pi") {
              setError(null);
              setSelectedModel(model);
            }
          }}
        />
      </header>
      <PortLogEvidenceInspector
        client={client}
        projectId={projectId}
        onOpenEvidence={(evidence) => void openEvidence(evidence)}
      />
      <ChatTranscriptPane
        activeThreadId={sessionId ?? "portlog-runtime-empty"}
        activeTurnId={activeTurnId ? TurnId.makeUnsafe(activeTurnId) : null}
        activeTurnInProgress={Boolean(activeTurnId)}
        activeTurnStartedAt={activeTurnStartedAt}
        chatFontSizePx={DEFAULT_CHAT_FONT_SIZE_PX}
        contentMaxWidthClassName="!max-w-none"
        emptyStateProjectName={undefined}
        hasMessages={timelineEntries.length > 0}
        isRevertingCheckpoint={false}
        isWorking={Boolean(activeTurnId)}
        followLiveOutput={Boolean(activeTurnId) && followTranscript}
        listRef={listRef}
        markdownCwd={props.workspaceRoot ?? undefined}
        onExpandTimelineImage={NOOP}
        onMessagesClickCapture={NOOP}
        onMessagesMouseUp={NOOP}
        onMessagesPointerCancel={NOOP}
        onMessagesPointerDown={NOOP}
        onMessagesPointerUp={NOOP}
        onMessagesScroll={NOOP}
        onMessagesTouchEnd={NOOP}
        onMessagesTouchMove={NOOP}
        onMessagesTouchStart={NOOP}
        onMessagesWheel={NOOP}
        onIsAtEndChange={setFollowTranscript}
        onOpenTurnDiff={NOOP}
        onOpenThread={NOOP}
        onRevertUserMessage={NOOP}
        onScrollToBottom={scrollToBottom}
        resolvedTheme="dark"
        revertTurnCountByUserMessageId={EMPTY_REVERT_TURN_COUNTS}
        scrollButtonVisible={!followTranscript && timelineEntries.length > 0}
        terminalWorkspaceTerminalTabActive={false}
        timelineEntries={timelineEntries}
        timestampFormat="locale"
        turnDiffSummaryByAssistantMessageId={EMPTY_TURN_DIFF_SUMMARIES}
        workspaceRoot={props.workspaceRoot ?? undefined}
        worktreeSetup={null}
        emptyStateContent={
          <div className="mx-auto flex h-full max-w-sm flex-col justify-center text-center">
            <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-border/80 bg-muted/30 text-xs font-semibold text-muted-foreground">
              PL
            </div>
            <h2 className="text-sm font-medium text-foreground">Start with the project evidence</h2>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Ask PortLog to inspect files, trace a process, or explain what the project supports.
            </p>
            {modelNeedsAuth ? (
              <p className="mt-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-left text-[11px] leading-4 text-amber-200">
                The selected model is visible, but this desktop process has no OpenRouter credential.
              </p>
            ) : null}
          </div>
        }
      />
      <form
        className="relative z-10 w-full shrink-0 overflow-visible px-3 pb-3 pt-0"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        data-chat-composer-form="true"
        data-testid="portlog-composer-form"
      >
        <ComposerColumnFrame className="!max-w-none">
          <div className={COMPOSER_INPUT_SHELL_CLASS_NAME}>
            <div className={COMPOSER_INPUT_SURFACE_CLASS_NAME}>
              <div className={COMPOSER_EDITOR_PADDING_CLASS_NAME}>
                <ComposerPromptEditor
                  ref={composerEditorRef}
                  value={draft}
                  cursor={composerCursor}
                  terminalContexts={[]}
                  mentionReferences={[]}
                  disabled={Boolean(activeTurnId)}
                  placeholder={modelNeedsAuth ? "Add an OpenRouter key to send…" : "Ask PortLog…"}
                  className="text-sm"
                  onRemoveTerminalContext={() => undefined}
                  onChange={(nextValue, nextCursor) => {
                    setError(null);
                    setDraft(nextValue);
                    setComposerCursor(nextCursor);
                  }}
                  onCommandKeyDown={(key, event) => {
                    if (key === "Enter" && !event.shiftKey && canSend) {
                      void send();
                      return true;
                    }
                    return false;
                  }}
                  onPaste={() => undefined}
                />
              </div>
              <div className={COMPOSER_FOOTER_ROW_CLASS_NAME}>
                <div className="min-w-0 flex-1" />
                <div className="flex shrink-0 items-center gap-1">
                  {activeTurnId ? (
                    <Button
                      type="button"
                      variant="prominent"
                      size="icon-xs"
                      className="size-7 rounded-full sm:size-7"
                      aria-label="Cancel turn"
                      title="Cancel turn"
                      onClick={() => void cancel()}
                    >
                      <span aria-hidden="true" className="block size-2 rounded-[1px] bg-current" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      variant="prominent"
                      size="icon-xs"
                      className="size-7 rounded-full sm:size-7"
                      aria-label="Send prompt"
                      title="Send prompt"
                      disabled={!canSend}
                    >
                      <ComposerSendArrowIcon aria-hidden="true" className="size-5 shrink-0 translate-y-px" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </ComposerColumnFrame>
      </form>
    </section>
  );
}
