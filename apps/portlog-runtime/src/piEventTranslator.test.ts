import { describe, expect, it } from "vitest";

import { translatePiEvent } from "./piEventTranslator";

const context = {
  streamId: "stream-1",
  cursor: 7,
  sessionId: "session-1",
  turnId: "turn-1",
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

describe("translatePiEvent", () => {
  it.each(["read", "write", "edit", "bash"])("translates %s lifecycle events", (toolName) => {
    const started = translatePiEvent(
      { type: "tool_execution_start", toolCallId: `${toolName}-call`, toolName, args: {} },
      context,
    );
    const completed = translatePiEvent(
      {
        type: "tool_execution_end",
        toolCallId: `${toolName}-call`,
        toolName,
        isError: false,
        result: `${toolName} result`,
      },
      context,
    );

    expect(started).toEqual([
      {
        ...context,
        type: "tool.started",
        toolCallId: `${toolName}-call`,
        toolName,
      },
    ]);
    expect(completed).toEqual([
      {
        ...context,
        type: "tool.completed",
        toolCallId: `${toolName}-call`,
        toolName,
        status: "completed",
        preview: `${toolName} result`,
      },
    ]);
  });

  it("translates assistant text and terminal states", () => {
    expect(
      translatePiEvent(
        {
          type: "message_update",
          message: { role: "assistant" },
          assistantMessageEvent: { type: "text_delta", delta: "grounded" },
        },
        context,
      ),
    ).toEqual([{ ...context, type: "assistant.delta", delta: "grounded" }]);

    expect(translatePiEvent({ type: "agent_end", messages: [], willRetry: false }, context)).toEqual([
      { ...context, type: "turn.completed", state: "completed" },
    ]);
    expect(
      translatePiEvent({ type: "agent_end", messages: [], willRetry: false }, context, undefined, true),
    ).toEqual([{ ...context, type: "turn.completed", state: "cancelled" }]);
    expect(
      translatePiEvent({ type: "agent_end", messages: [], willRetry: false }, context, "provider failed"),
    ).toEqual([
      { ...context, type: "turn.completed", state: "failed", errorMessage: "provider failed" },
    ]);
  });

  it("preserves session usage on completed turns", () => {
    expect(
      translatePiEvent(
        { type: "agent_end", messages: [], willRetry: false },
        context,
        undefined,
        false,
        {
          inputTokens: 10,
          outputTokens: 4,
          cacheReadTokens: 2,
          cacheWriteTokens: 1,
          totalTokens: 14,
          cost: 0.003,
        },
      ),
    ).toEqual([
      {
        ...context,
        type: "turn.completed",
        state: "completed",
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          cacheReadTokens: 2,
          cacheWriteTokens: 1,
          totalTokens: 14,
          cost: 0.003,
        },
      },
    ]);
  });

  it("ignores unrelated Pi events", () => {
    expect(translatePiEvent({ type: "turn_start" }, context)).toEqual([]);
    expect(translatePiEvent(null, context)).toEqual([]);
  });
});
