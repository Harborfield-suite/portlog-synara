import type { ProviderKind } from "@synara/contracts";
import { Effect } from "effect";

import type { AgentGatewayTargetError } from "./targetResolver.ts";
import type { AgentGatewayCapability } from "./Services/AgentGatewaySessionRegistry.ts";
import {
  mcpToolResultJson,
  type JsonRpcId,
  type McpToolCallResult,
  type McpToolDefinition,
} from "./protocol.ts";

export const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const WRITE_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export interface ProviderSessionPrincipal {
  readonly kind: "provider-session";
  readonly sessionKey: string;
  readonly threadId: string;
  readonly provider: ProviderKind;
  readonly turnId: string | null;
}

export interface ExternalClientPrincipal {
  readonly kind: "external-client";
  readonly integrationId: string;
  readonly name: string;
}

export type AgentGatewayPrincipal = ProviderSessionPrincipal | ExternalClientPrincipal;

export interface ToolContext {
  readonly principal: ProviderSessionPrincipal;
  readonly callerThreadId: string;
  readonly callerSessionKey: string;
  readonly callerProvider: ProviderKind;
  readonly callerCapabilities: ReadonlySet<AgentGatewayCapability>;
  readonly callerTurnId: string | null;
  readonly assertCallerTurnActive: () => Effect.Effect<void, GatewayToolError>;
  readonly jsonRpcRequestId: JsonRpcId;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Effect.Effect<McpToolCallResult>;

export interface ToolEntry {
  readonly definition: McpToolDefinition;
  readonly handler: ToolHandler;
  readonly requiredCapability: AgentGatewayCapability;
  readonly requiresActiveTurn?: boolean;
}

export interface McpToolEntry<Context, Capability extends string> {
  readonly definition: McpToolDefinition;
  readonly handler: (
    args: Record<string, unknown>,
    context: Context,
  ) => Effect.Effect<McpToolCallResult>;
  readonly requiredCapability: Capability;
}

/** Single capability and policy boundary for MCP tool calls. */
export class AgentGatewayToolRegistry {
  private readonly toolsByName: ReadonlyMap<string, ToolEntry>;
  readonly tools: ReadonlyArray<ToolEntry>;

  constructor(tools: ReadonlyArray<ToolEntry>) {
    const byName = new Map<string, ToolEntry>();
    for (const tool of tools) {
      const name = tool.definition.name;
      if (byName.has(name)) {
        throw new Error(`Duplicate agent gateway tool registration: ${name}`);
      }
      byName.set(name, tool);
    }
    this.tools = [...tools];
    this.toolsByName = byName;
  }

  listDefinitions(): ReadonlyArray<McpToolDefinition> {
    return this.tools.map((tool) => tool.definition);
  }

  get(name: string): ToolEntry | undefined {
    return this.toolsByName.get(name);
  }

  dispatch(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Effect.Effect<McpToolCallResult> {
    const tool = this.toolsByName.get(name);
    if (!tool) {
      return Effect.succeed(
        mcpToolResultJson({
          error: { code: "unknown_tool", message: `Unknown tool "${name}".` },
        }),
      );
    }
    return Effect.gen(function* () {
      if (!context.callerCapabilities.has(tool.requiredCapability)) {
        return gatewayToolErrorResult(
          new GatewayToolError(
            "capability_denied",
            `This provider session is not authorized for ${tool.requiredCapability}.`,
            { requiredCapability: tool.requiredCapability },
          ),
        );
      }
      if (tool.requiresActiveTurn) {
        const authorityError = yield* context.assertCallerTurnActive().pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => null,
          }),
        );
        if (authorityError !== null) return gatewayToolErrorResult(authorityError);
      }
      return yield* Effect.suspend(() => tool.handler(args, context));
    });
  }
}

export class GatewayToolError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function gatewayToolErrorResult(error: GatewayToolError | AgentGatewayTargetError) {
  return {
    ...mcpToolResultJson({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    }),
    isError: true as const,
  };
}
