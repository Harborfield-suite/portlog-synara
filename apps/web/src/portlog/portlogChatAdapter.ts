import {
  MessageId,
  TurnId,
  type PortLogRuntimeEvent,
} from "@synara/contracts";

import type { ChatMessage } from "../types";
import {
  deriveTimelineEntries,
  type TimelineEntry,
  type WorkLogEntry,
} from "../workLog";
import type { SynaraMcpToolStatus } from "../lib/toolCallLabel";

export interface PortLogChatState {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly workEntries: ReadonlyArray<WorkLogEntry>;
  readonly lastEventByTurn: Readonly<Record<string, "user" | "assistant" | "tool" | "completed" | "error">>;
  readonly assistantSegmentByTurn: Readonly<Record<string, number>>;
  readonly appliedEventKeys: ReadonlySet<string>;
}

export function createPortLogChatState(): PortLogChatState {
  return {
    messages: [],
    workEntries: [],
    lastEventByTurn: {},
    assistantSegmentByTurn: {},
    appliedEventKeys: new Set(),
  };
}

function eventTimestamp(event: PortLogRuntimeEvent): string {
  return event.createdAt ?? new Date(event.cursor).toISOString();
}

function turnKey(event: PortLogRuntimeEvent): string {
  return event.turnId ?? `stream:${event.streamId}`;
}

function turnId(event: PortLogRuntimeEvent): TurnId | null {
  return event.turnId ? TurnId.makeUnsafe(event.turnId) : null;
}

function replaceMessage(messages: ReadonlyArray<ChatMessage>, next: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) return [...messages, next];
  return messages.map((message, messageIndex) => (messageIndex === index ? next : message));
}

function replaceWorkEntry(entries: ReadonlyArray<WorkLogEntry>, next: WorkLogEntry): WorkLogEntry[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return [...entries, next];
  return entries.map((entry, entryIndex) => (entryIndex === index ? next : entry));
}

function copyState(state: PortLogChatState, event: PortLogRuntimeEvent): PortLogChatState {
  const appliedEventKeys = new Set(state.appliedEventKeys);
  appliedEventKeys.add(`${event.streamId}:${event.cursor}`);
  return { ...state, appliedEventKeys };
}

function errorMessageId(event: PortLogRuntimeEvent): string {
  return `portlog:error:${turnKey(event)}:${event.cursor}`;
}

function applyErrorMessage(
  state: PortLogChatState,
  event: PortLogRuntimeEvent,
  text: string,
): PortLogChatState {
  const message: ChatMessage = {
    id: MessageId.makeUnsafe(errorMessageId(event)),
    role: "system",
    text,
    createdAt: eventTimestamp(event),
    streaming: false,
    source: "native",
    turnId: turnId(event),
  };
  return copyState(
    {
      ...state,
      messages: replaceMessage(state.messages, message),
      lastEventByTurn: { ...state.lastEventByTurn, [turnKey(event)]: "error" },
    },
    event,
  );
}

export function applyPortLogEvent(
  state: PortLogChatState,
  event: PortLogRuntimeEvent,
): PortLogChatState {
  const eventKey = `${event.streamId}:${event.cursor}`;
  if (state.appliedEventKeys.has(eventKey)) return state;

  const key = turnKey(event);
  const messageTurnId = turnId(event);

  switch (event.type) {
    case "user.message": {
      const id = `portlog:user:${key}`;
      const message: ChatMessage = {
        id: MessageId.makeUnsafe(id),
        role: "user",
        text: event.text,
        createdAt: eventTimestamp(event),
        streaming: false,
        source: "native",
        turnId: messageTurnId,
      };
      return copyState(
        {
          ...state,
          messages: replaceMessage(state.messages, message),
          lastEventByTurn: { ...state.lastEventByTurn, [key]: "user" },
        },
        event,
      );
    }
    case "assistant.delta": {
      const previousKind = state.lastEventByTurn[key];
      const segment =
        previousKind === "assistant"
          ? (state.assistantSegmentByTurn[key] ?? 1)
          : (state.assistantSegmentByTurn[key] ?? 0) + 1;
      const id = `portlog:assistant:${key}:${segment}`;
      const previous = state.messages.find((message) => message.id === MessageId.makeUnsafe(id));
      const message: ChatMessage = {
        id: MessageId.makeUnsafe(id),
        role: "assistant",
        text: `${previous?.text ?? ""}${event.delta}`,
        createdAt: previous?.createdAt ?? eventTimestamp(event),
        streaming: true,
        source: "native",
        turnId: messageTurnId,
      };
      return copyState(
        {
          ...state,
          messages: replaceMessage(state.messages, message),
          lastEventByTurn: { ...state.lastEventByTurn, [key]: "assistant" },
          assistantSegmentByTurn: { ...state.assistantSegmentByTurn, [key]: segment },
        },
        event,
      );
    }
    case "tool.started": {
      const id = `portlog:tool:${event.toolCallId}`;
      const entry: WorkLogEntry = {
        id,
        createdAt: eventTimestamp(event),
        label: event.toolName,
        tone: "tool",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        toolStatus: "running",
        turnId: messageTurnId,
      };
      return copyState(
        {
          ...state,
          workEntries: replaceWorkEntry(state.workEntries, entry),
          lastEventByTurn: { ...state.lastEventByTurn, [key]: "tool" },
        },
        event,
      );
    }
    case "tool.completed": {
      const id = `portlog:tool:${event.toolCallId}`;
      const previous = state.workEntries.find((entry) => entry.id === id);
      const status: SynaraMcpToolStatus = event.status;
      const entry: WorkLogEntry = {
        id,
        createdAt: previous?.createdAt ?? eventTimestamp(event),
        label: event.toolName,
        ...(event.preview ? { detail: event.preview, preview: event.preview } : {}),
        tone: event.status === "completed" ? "tool" : "error",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        toolStatus: status,
        turnId: messageTurnId,
      };
      return copyState(
        {
          ...state,
          workEntries: replaceWorkEntry(state.workEntries, entry),
          lastEventByTurn: { ...state.lastEventByTurn, [key]: "tool" },
        },
        event,
      );
    }
    case "runtime.error":
      return applyErrorMessage(state, event, event.message);
    case "turn.completed": {
      const messages = state.messages.map((message) =>
        message.role === "assistant" && message.turnId === messageTurnId
          ? { ...message, streaming: false, completedAt: eventTimestamp(event) }
          : message,
      );
      const next = copyState(
        {
          ...state,
          messages,
          lastEventByTurn: { ...state.lastEventByTurn, [key]: "completed" },
        },
        event,
      );
      return event.errorMessage ? applyErrorMessage(next, event, event.errorMessage) : next;
    }
  }
}

export function portLogTimelineEntries(state: PortLogChatState): TimelineEntry[] {
  return deriveTimelineEntries([...state.messages], [], [...state.workEntries]);
}
