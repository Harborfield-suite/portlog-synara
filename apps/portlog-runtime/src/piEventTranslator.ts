import type { PortLogRuntimeEvent, PortLogRuntimeUsage } from "@synara/contracts";

export interface PiEventContext {
  readonly streamId: string;
  readonly cursor: number;
  readonly sessionId: string;
  readonly turnId?: string;
}

function eventBase(context: PiEventContext): PiEventContext {
  return context;
}

function preview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  const normalized = text.trim();
  return normalized.length > 2_000 ? `${normalized.slice(0, 2_000)}…` : normalized;
}

export function translatePiEvent(
  event: unknown,
  context: PiEventContext,
  errorMessage?: string,
  cancelled = false,
  usage?: PortLogRuntimeUsage,
): ReadonlyArray<PortLogRuntimeEvent> {
  if (!event || typeof event !== "object") return [];
  const value = event as Record<string, unknown>;
  const type = value.type;
  const base = eventBase(context);

  if (type === "message_update") {
    const message = value.message;
    const update = value.assistantMessageEvent;
    if (
      message &&
      typeof message === "object" &&
      (message as Record<string, unknown>).role === "assistant" &&
      update &&
      typeof update === "object" &&
      (update as Record<string, unknown>).type === "text_delta" &&
      typeof (update as Record<string, unknown>).delta === "string"
    ) {
      return [
        {
          ...base,
          type: "assistant.delta",
          delta: (update as Record<string, unknown>).delta as string,
        },
      ];
    }
    return [];
  }

  if (type === "tool_execution_start") {
    if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string") return [];
    return [
      {
        ...base,
        type: "tool.started",
        toolCallId: value.toolCallId,
        toolName: value.toolName,
      },
    ];
  }

  if (type === "tool_execution_end") {
    if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string") return [];
    const resultPreview = preview(value.result);
    const toolEvent: PortLogRuntimeEvent = {
      ...base,
      type: "tool.completed",
      toolCallId: value.toolCallId,
      toolName: value.toolName,
      status: value.isError === true ? "failed" : "completed",
      ...(resultPreview ? { preview: resultPreview } : {}),
    };
    return [toolEvent];
  }

  if (type === "agent_end" && context.turnId) {
    return [
      {
        ...base,
        type: "turn.completed",
        state: cancelled ? "cancelled" : errorMessage ? "failed" : "completed",
        ...(errorMessage ? { errorMessage } : {}),
        ...(usage ? { usage } : {}),
      },
    ];
  }

  return [];
}
