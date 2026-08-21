import { TurnId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { durableTurnIdForMessage, resolveStableMessageTurnId } from "./messageTurnId.ts";

describe("durableTurnIdForMessage", () => {
  it("is stable for retries of the same thread message", () => {
    expect(
      durableTurnIdForMessage({ threadId: "thread-1" as never, messageId: "message-1" }),
    ).toBe("synara-turn:thread-1:message-1");
    expect(
      durableTurnIdForMessage({ threadId: "thread-1" as never, messageId: "message-1" }),
    ).toBe("synara-turn:thread-1:message-1");
  });
});

describe("resolveStableMessageTurnId", () => {
  it("keeps the existing turn id when a later event carries a different one", () => {
    expect(
      resolveStableMessageTurnId({
        existingTurnId: TurnId.makeUnsafe("turn-original"),
        incomingTurnId: TurnId.makeUnsafe("turn-later"),
      }),
    ).toBe("turn-original");
  });

  it("uses the incoming turn id when the message has no previous turn", () => {
    expect(
      resolveStableMessageTurnId({
        existingTurnId: null,
        incomingTurnId: TurnId.makeUnsafe("turn-incoming"),
      }),
    ).toBe("turn-incoming");
  });

  it("returns null when no turn id is available", () => {
    expect(
      resolveStableMessageTurnId({
        existingTurnId: undefined,
        incomingTurnId: undefined,
      }),
    ).toBeNull();
  });
});
