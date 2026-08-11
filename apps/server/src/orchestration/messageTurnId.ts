import { TurnId, type ThreadId } from "@synara/contracts";

/**
 * Derive the durable turn identity for one user message.
 *
 * Provider runtimes may mint their own native ids, but a retried orchestration
 * command must address the same durable turn. Message ids are already durable
 * and unique within the thread, so they are the correct idempotency source.
 */
export function durableTurnIdForMessage(input: {
  readonly threadId: ThreadId;
  readonly messageId: string;
}): TurnId {
  return TurnId.makeUnsafe(`synara-turn:${input.threadId}:${input.messageId}`);
}

export function resolveStableMessageTurnId(input: {
  readonly existingTurnId?: TurnId | null | undefined;
  readonly incomingTurnId?: TurnId | null | undefined;
}): TurnId | null {
  return input.existingTurnId ?? input.incomingTurnId ?? null;
}
