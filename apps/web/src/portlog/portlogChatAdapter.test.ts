import { describe, expect, it } from "vitest";

import type { PortLogRuntimeEvent } from "@synara/contracts";

import {
  applyPortLogEvent,
  createPortLogChatState,
  portLogTimelineEntries,
} from "./portlogChatAdapter";

const base = {
  streamId: "stream-1",
  sessionId: "session-1",
  turnId: "turn-1",
} as const;

function event(
  cursor: number,
  createdAt: string,
  value: { readonly type: PortLogRuntimeEvent["type"]; readonly [key: string]: unknown },
): PortLogRuntimeEvent {
  return { ...base, cursor, createdAt, ...value } as unknown as PortLogRuntimeEvent;
}

describe("PortLog chat adapter", () => {
  it("replays a mixed turn into Synara timeline entries with stable identity", () => {
    const events = [
      event(1, "2026-01-01T00:00:00.000Z", {
        type: "user.message",
        text: "Inspect the fixture.",
      }),
      event(2, "2026-01-01T00:00:01.000Z", {
        type: "assistant.delta",
        delta: "I will inspect it.",
      }),
      event(3, "2026-01-01T00:00:02.000Z", {
        type: "tool.started",
        toolCallId: "read-1",
        toolName: "read",
      }),
      event(4, "2026-01-01T00:00:03.000Z", {
        type: "tool.completed",
        toolCallId: "read-1",
        toolName: "read",
        status: "completed",
        preview: "fixture contents",
      }),
      event(5, "2026-01-01T00:00:04.000Z", {
        type: "assistant.delta",
        delta: " The fixture is valid.",
      }),
      event(6, "2026-01-01T00:00:05.000Z", {
        type: "turn.completed",
        state: "completed",
      }),
    ];

    const live = events.reduce(applyPortLogEvent, createPortLogChatState());
    const recovered = events.reduce(applyPortLogEvent, createPortLogChatState());
    const liveEntries = portLogTimelineEntries(live);
    const recoveredEntries = portLogTimelineEntries(recovered);

    expect(liveEntries.map((entry) => entry.id)).toEqual(recoveredEntries.map((entry) => entry.id));
    expect(liveEntries.map((entry) => entry.createdAt)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:01.000Z",
      "2026-01-01T00:00:02.000Z",
      "2026-01-01T00:00:04.000Z",
    ]);
    expect(live.messages.map((message) => [message.role, message.text, message.streaming])).toEqual([
      ["user", "Inspect the fixture.", false],
      ["assistant", "I will inspect it.", false],
      ["assistant", " The fixture is valid.", false],
    ]);
    expect(live.workEntries[0]).toMatchObject({
      toolCallId: "read-1",
      toolStatus: "completed",
      preview: "fixture contents",
    });
  });

  it("does not duplicate a replayed event", () => {
    const first = event(1, "2026-01-01T00:00:00.000Z", {
      type: "user.message",
      text: "Keep this once.",
    });
    const state = applyPortLogEvent(
      applyPortLogEvent(createPortLogChatState(), first),
      first,
    );

    expect(state.messages).toHaveLength(1);
    expect(portLogTimelineEntries(state)).toHaveLength(1);
  });
});
