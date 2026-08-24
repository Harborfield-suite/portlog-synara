import {
  MessageId,
  MODEL_OPTIONS_BY_PROVIDER,
  TurnId,
  type ModelSlug,
  type ProviderKind,
  type PortLogRuntimeEvent,
  type PortLogRuntimeEvidence,
  type PortLogRuntimeModel,
} from "@synara/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "../components/ComposerPromptEditor";
import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import type { ProviderModelOption } from "../providerModelOptions";
import { ArrowUpIcon, StopIcon } from "../lib/icons";
import { getPortLogRuntimeClient, type PortLogRuntimeClient } from "./portlogRuntimeClient";
import { PortLogEvidenceInspector } from "./PortLogEvidenceInspector";
import { MessagesTimeline } from "../components/chat/MessagesTimeline";
import type { TimelineEntry } from "../workLog";

interface PortLogRuntimeChatPanelProps {
  readonly workspaceRoot: string | null;
  readonly onOpenEvidence: (evidenceId: string, sourcePath: string | null) => void;
}

type TranscriptRow = {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool" | "error";
  readonly text: string;
  readonly createdAt?: string;
};

const DEFAULT_MODEL: ModelSlug = "openrouter/deepseek/deepseek-v4-flash";

function runtimeSessionStorageKey(workspaceRoot: string): string {
  return `portlog-runtime-session:${workspaceRoot}`;
}

function newId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function modelOptions(models: ReadonlyArray<PortLogRuntimeModel>): Record<ProviderKind, ReadonlyArray<ProviderModelOption>> {
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

function applyEvent(rows: ReadonlyArray<TranscriptRow>, event: PortLogRuntimeEvent): TranscriptRow[] {
  switch (event.type) {
    case "user.message":
      return rows.some((row) => row.id === event.turnId)
        ? [...rows]
        : [...rows, { id: event.turnId ?? newId("user"), role: "user", text: event.text }];
    case "assistant.delta": {
      const last = rows.at(-1);
      if (last?.role === "assistant") {
        return [...rows.slice(0, -1), { ...last, text: `${last.text}${event.delta}` }];
      }
      return [...rows, { id: newId("assistant"), role: "assistant", text: event.delta }];
    }
    case "tool.started":
      return [
        ...rows,
        { id: event.toolCallId, role: "tool", text: `Running ${event.toolName}…` },
      ];
    case "tool.completed":
      return rows.map((row) =>
        row.id === event.toolCallId
          ? {
              ...row,
              text: `${event.status === "completed" ? "Completed" : "Failed"} ${event.toolName}${event.preview ? `\n${event.preview}` : ""}`,
            }
          : row,
      );
    case "runtime.error":
      return [...rows, { id: newId("error"), role: "error", text: event.message }];
    case "turn.completed":
      return event.errorMessage
        ? [...rows, { id: newId("error"), role: "error", text: event.errorMessage }]
        : [...rows];
  }
}

export function PortLogRuntimeChatPanel(props: PortLogRuntimeChatPanelProps) {
  const client = useMemo<PortLogRuntimeClient | null>(() => getPortLogRuntimeClient(), []);
  const [models, setModels] = useState<ReadonlyArray<PortLogRuntimeModel>>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSlug>(DEFAULT_MODEL);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [rows, setRows] = useState<ReadonlyArray<TranscriptRow>>([]);
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
  const timelineEntries = useMemo<ReadonlyArray<TimelineEntry>>(
    () =>
      rows.map((row) => {
        const createdAt = row.createdAt ?? "1970-01-01T00:00:00.000Z";
        if (row.role === "tool") {
          return {
            id: row.id,
            kind: "work",
            createdAt,
            entry: {
              id: row.id,
              createdAt,
              label: row.text,
              tone: "tool",
              toolName: row.text.replace(/^(Running|Completed|Failed) /u, "").replace(/…$/u, ""),
              toolCallId: row.id,
              turnId: activeTurnId ? TurnId.makeUnsafe(activeTurnId) : null,
            },
          };
        }
        return {
          id: row.id,
          kind: "message",
          createdAt,
          message: {
            id: MessageId.makeUnsafe(row.id),
            role: row.role === "error" ? "system" : row.role,
            text: row.text,
            createdAt,
            streaming: row.role === "assistant" && Boolean(activeTurnId),
            turnId: activeTurnId ? TurnId.makeUnsafe(activeTurnId) : null,
          },
        };
      }),
    [activeTurnId, rows],
  );
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
    const saved = localStorage.getItem(runtimeSessionStorageKey(props.workspaceRoot));
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { projectId?: unknown; sessionId?: unknown };
      if (typeof parsed.projectId !== "string" || typeof parsed.sessionId !== "string") return;
      setProjectId(parsed.projectId);
      setSessionId(parsed.sessionId);
      const recovery = {
        sessionId: parsed.sessionId,
        pending: [],
        snapshotPending: true,
      };
      recoveryRef.current = recovery;
      void client.attachSession({ sessionId: parsed.sessionId }).then(
        (snapshot) => {
          if (recoveryRef.current !== recovery) return;
          const installed = snapshot.events.reduce(applyEvent, [] as ReadonlyArray<TranscriptRow>);
          const pending = recovery.pending.filter(
            (event) => event.streamId === snapshot.streamId && event.cursor > snapshot.cursor,
          );
          setRows(pending.reduce(applyEvent, installed));
          setActiveTurnId(snapshot.activeTurnId ?? null);
          if (snapshot.state === "interrupted") setStatus("Previous turn interrupted; review before continuing");
          recovery.snapshotPending = false;
          recoveryRef.current = null;
        },
        () => {
          if (recoveryRef.current === recovery) recoveryRef.current = null;
          localStorage.removeItem(runtimeSessionStorageKey(props.workspaceRoot));
          setProjectId(null);
          setSessionId(null);
        },
      );
    } catch {
      localStorage.removeItem(runtimeSessionStorageKey(props.workspaceRoot));
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
      setRows((previous) => applyEvent(previous, event));
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
    setRows((previous) => [...previous, { id: turnId, role: "user", text }]);
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

  if (!client) {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">PortLog runtime is available in the desktop app.</div>;
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="PortLog runtime chat">
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
      <MessagesTimeline
        hasMessages={timelineEntries.length > 0}
        isWorking={Boolean(activeTurnId)}
        activeTurnInProgress={Boolean(activeTurnId)}
        activeTurnStartedAt={activeTurnStartedAt}
        followLiveOutput={followTranscript}
        timelineEntries={timelineEntries}
        turnDiffSummaryByAssistantMessageId={new Map()}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => undefined}
        isRevertingCheckpoint={false}
        onOpenTurnDiff={() => undefined}
        onImageExpand={() => undefined}
        markdownCwd={props.workspaceRoot ?? undefined}
        resolvedTheme="dark"
        timestampFormat="locale"
        workspaceRoot={props.workspaceRoot ?? undefined}
        onIsAtEndChange={setFollowTranscript}
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
      <footer className="shrink-0 border-t border-border/65 px-3 py-3">
        <div className="rounded-xl border border-border/85 bg-muted/15 p-2 shadow-sm focus-within:border-ring/70 focus-within:bg-muted/25">
          <ComposerPromptEditor
            ref={composerEditorRef}
            value={draft}
            cursor={composerCursor}
            terminalContexts={[]}
            mentionReferences={[]}
            disabled={Boolean(activeTurnId)}
            placeholder={modelNeedsAuth ? "Add an OpenRouter key to send…" : "Ask PortLog…"}
            className="px-1 py-1 text-sm"
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
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="truncate text-[10px] text-muted-foreground/70">Enter to send · Shift+Enter for a new line · Escape to cancel</span>
            <div className="flex items-center gap-1">
              {activeTurnId ? (
                <button
                  type="button"
                  aria-label="Cancel turn"
                  title="Cancel turn"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => void cancel()}
                >
                  <StopIcon className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Send prompt"
                title="Send prompt"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={!canSend}
                onClick={() => void send()}
              >
                <ArrowUpIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </footer>
    </section>
  );
}
