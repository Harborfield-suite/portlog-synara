import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  AgentGatewayToolRegistry,
  GatewayToolError,
  type ToolContext,
  type ToolEntry,
} from "./toolRuntime.ts";

const definition = (name: string) => ({
  name,
  description: "test tool",
  inputSchema: { type: "object" },
});

function context(input: {
  readonly capabilities?: ReadonlyArray<"thread:read" | "thread:write">;
  readonly active?: boolean;
  readonly onActiveCheck?: () => void;
}): ToolContext {
  return {
    principal: {
      kind: "provider-session",
      sessionKey: "session-test",
      threadId: "thread-test",
      provider: "codex",
      turnId: "turn-test",
    },
    callerThreadId: "thread-test",
    callerSessionKey: "session-test",
    callerProvider: "codex",
    callerCapabilities: new Set(input.capabilities ?? ["thread:read"]),
    callerTurnId: "turn-test",
    assertCallerTurnActive: () => {
      input.onActiveCheck?.();
      return input.active === false
        ? Effect.fail(new GatewayToolError("caller_turn_inactive", "inactive"))
        : Effect.void;
    },
    jsonRpcRequestId: "request-test",
  };
}

function tool(name: string, handler: ToolEntry["handler"]): ToolEntry {
  return {
    definition: definition(name),
    handler,
    requiredCapability: "thread:read",
    requiresActiveTurn: true,
  };
}

describe("AgentGatewayToolRegistry", () => {
  it.effect("lists registered tools and dispatches a permitted call", () =>
    Effect.gen(function* () {
      let calls = 0;
      const registry = new AgentGatewayToolRegistry([
        tool("synara_test", () => {
          calls += 1;
          return Effect.succeed({ content: [{ type: "text", text: "ok" }] });
        }),
      ]);

      assert.deepStrictEqual(registry.listDefinitions().map((entry) => entry.name), ["synara_test"]);
      const result = yield* registry.dispatch("synara_test", {}, context({}));
      assert.equal(calls, 1);
      assert.deepStrictEqual(result.content, [{ type: "text", text: "ok" }]);
    }),
  );

  it.effect("denies missing capability before invoking the handler", () =>
    Effect.gen(function* () {
      let calls = 0;
      const registry = new AgentGatewayToolRegistry([
        tool("synara_test", () => {
          calls += 1;
          return Effect.succeed({ content: [{ type: "text", text: "ok" }] });
        }),
      ]);

      const result = yield* registry.dispatch(
        "synara_test",
        {},
        context({ capabilities: ["thread:write"] }),
      );
      assert.equal(calls, 0);
      assert.equal(result.isError, true);
      const firstContent = result.content[0];
      assert.equal(firstContent?.type, "text");
      if (firstContent?.type === "text") {
        assert.deepStrictEqual(JSON.parse(firstContent.text), {
          error: {
            code: "capability_denied",
            message: "This provider session is not authorized for thread:read.",
            details: { requiredCapability: "thread:read" },
          },
        });
      }
    }),
  );

  it.effect("denies an inactive turn before invoking the handler", () =>
    Effect.gen(function* () {
      let calls = 0;
      const registry = new AgentGatewayToolRegistry([
        tool("synara_test", () => {
          calls += 1;
          return Effect.succeed({ content: [{ type: "text", text: "ok" }] });
        }),
      ]);

      let authorityChecks = 0;
      const result = yield* registry.dispatch(
        "synara_test",
        {},
        context({ active: false, onActiveCheck: () => (authorityChecks += 1) }),
      );
      assert.equal(calls, 0);
      assert.equal(authorityChecks, 1);
      assert.equal(result.isError, true);
      const firstContent = result.content[0];
      assert.equal(firstContent?.type, "text");
      if (firstContent?.type === "text") {
        assert.deepStrictEqual(JSON.parse(firstContent.text), {
          error: {
            code: "caller_turn_inactive",
            message: "inactive",
          },
        });
      }
    }),
  );

  it.effect("rejects unknown tools without invoking a registered handler", () =>
    Effect.gen(function* () {
      let calls = 0;
      const registry = new AgentGatewayToolRegistry([
        tool("synara_test", () => {
          calls += 1;
          return Effect.succeed({ content: [{ type: "text", text: "ok" }] });
        }),
      ]);

      const result = yield* registry.dispatch("synara_missing", {}, context({}));
      assert.equal(calls, 0);
      assert.equal(result.isError, undefined);
      const firstContent = result.content[0];
      assert.equal(firstContent?.type, "text");
      if (firstContent?.type === "text") assert.match(firstContent.text, /unknown_tool/);
    }),
  );

  it("rejects duplicate registrations deterministically", () => {
    assert.throws(
      () =>
        new AgentGatewayToolRegistry([
          tool("duplicate", () => Effect.succeed({ content: [] })),
          tool("duplicate", () => Effect.succeed({ content: [] })),
        ]),
      /Duplicate agent gateway tool registration/,
    );
  });
});
