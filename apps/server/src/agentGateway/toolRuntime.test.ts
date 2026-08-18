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
  readonly injectSecret?: ToolContext["injectSecret"];
  readonly recordSecretAudit?: ToolContext["recordSecretAudit"];
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
    ...(input.injectSecret ? { injectSecret: input.injectSecret } : {}),
    ...(input.recordSecretAudit ? { recordSecretAudit: input.recordSecretAudit } : {}),
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

  it.effect("requires an injected secret boundary for secret-capable tools", () =>
    Effect.gen(function* () {
      const registry = new AgentGatewayToolRegistry([
        {
          ...tool("secret_tool", () => Effect.succeed({ content: [{ type: "text", text: "no" }] })),
          secretBinding: {
            scope: "provider:openai",
            channel: "environment" as const,
            target: "OPENAI_API_KEY",
          },
        },
      ]);

      const result = yield* registry.dispatch("secret_tool", {}, context({}));
      assert.equal(result.isError, true);
      const firstContent = result.content[0];
      assert.equal(firstContent?.type, "text");
      if (firstContent?.type === "text") {
        assert.deepStrictEqual(JSON.parse(firstContent.text).error.code, "secret_capability_unavailable");
      }
    }),
  );

  it.effect("passes declared secret injection through the harness boundary without exposing it in tool output", () =>
    Effect.gen(function* () {
      let injected = false;
      let audited = false;
      const registry = new AgentGatewayToolRegistry([
        {
          ...tool("secret_tool", (_args, toolContext) =>
            Effect.gen(function* () {
              const result = yield* toolContext
                .injectSecret!({
                  scope: "provider:openai",
                  channel: "environment",
                  target: "OPENAI_API_KEY",
                })
                .pipe(Effect.orDie);
              injected = result?.value === "raw-secret";
              yield* toolContext.recordSecretAudit!({
                scope: "provider:openai",
                channel: "environment",
                outcome: "injected",
              });
              return { content: [{ type: "text", text: "credential used" }] };
            }),
          ),
          secretBinding: {
            scope: "provider:openai",
            channel: "environment" as const,
            target: "OPENAI_API_KEY",
          },
        },
      ]);

      const result = yield* registry.dispatch(
        "secret_tool",
        {},
        context({
          injectSecret: () =>
            Effect.succeed({
              value: "raw-secret",
              audit: { scope: "provider:openai", channel: "environment" as const, outcome: "injected" as const },
            }),
          recordSecretAudit: () => Effect.sync(() => (audited = true)),
        }),
      );
      assert.equal(injected, true);
      assert.equal(audited, true);
      assert.deepStrictEqual(result.content, [{ type: "text", text: "credential used" }]);
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
