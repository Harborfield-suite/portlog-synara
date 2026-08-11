import {
  EventId,
  type HarnessInvocationRecord,
  type HarnessInvocationTarget,
  type OrchestrationThreadActivity,
} from "@synara/contracts";

const targetLabel = (target: HarnessInvocationTarget): string => {
  switch (target.kind) {
    case "model":
      return `Model · ${target.modelSelection.model}`;
    case "tool":
      return `Tool · ${target.toolName}`;
    case "logic_program":
      return `Logic program · ${target.program}`;
  }
};

const stateLabel = (state: HarnessInvocationRecord["state"]): string => {
  switch (state) {
    case "running": return "running";
    case "completed": return "completed";
    case "failed": return "failed";
    case "unknown": return "unknown — reconciliation required";
    case "interrupted": return "interrupted";
    case "cancelled": return "cancelled";
  }
};

const MAX_DETAIL_CHARS = 4_000;
const MAX_DETAIL_ITEMS = 32;
const MAX_ACTIVITY_PAYLOAD_CHARS = 12_000;
function boundDetail(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return value.length > MAX_DETAIL_CHARS ? `${value.slice(0, MAX_DETAIL_CHARS)}…` : value;
  if (Array.isArray(value)) return value.slice(0, MAX_DETAIL_ITEMS).map((item) => boundDetail(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, MAX_DETAIL_ITEMS).map(([key, item]) => [key, boundDetail(item, depth + 1)]));
  }
  return value;
}

const compactTarget = (target: HarnessInvocationTarget): Record<string, unknown> => {
  switch (target.kind) {
    case "model":
      return { kind: target.kind, modelSelection: { provider: String(target.modelSelection.provider).slice(0, 128), model: String(target.modelSelection.model).slice(0, 256) } };
    case "tool":
      return { kind: target.kind, toolName: target.toolName.slice(0, 256) };
    case "logic_program":
      return { kind: target.kind, program: target.program.slice(0, 256), deterministic: target.deterministic };
  }
};

const boundedPayload = (record: HarnessInvocationRecord): OrchestrationThreadActivity["payload"] => {
  const payload: Record<string, unknown> = {
    invocationId: record.invocationId,
    target: boundDetail(record.target),
    state: record.state,
    currentAttempt: record.currentAttempt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    ...(record.checkpoint !== null ? { checkpoint: boundDetail(record.checkpoint) } : {}),
    ...(record.result !== null ? { result: boundDetail(record.result) } : {}),
    ...(record.error !== null ? { error: boundDetail(record.error) } : {}),
  };
  if (JSON.stringify(payload).length <= MAX_ACTIVITY_PAYLOAD_CHARS) return payload as OrchestrationThreadActivity["payload"];
  return {
    invocationId: record.invocationId,
    target: compactTarget(record.target),
    state: record.state,
    currentAttempt: record.currentAttempt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    detailTruncated: true,
    ...(record.checkpoint !== null ? { checkpoint: "[truncated]" } : {}),
    ...(record.result !== null ? { result: "[truncated]" } : {}),
    ...(record.error !== null ? { error: "[truncated]" } : {}),
  } as OrchestrationThreadActivity["payload"];
};

export function harnessInvocationActivity(
  record: HarnessInvocationRecord,
): OrchestrationThreadActivity {
  const label = targetLabel(record.target);
  return {
    id: EventId.makeUnsafe(`harness-invocation:${record.invocationId}`),
    tone: record.state === "failed" || record.state === "unknown" ? "error" : "info",
    kind: "harness.invocation",
    summary: `${label} · ${stateLabel(record.state)}`,
    payload: boundedPayload(record),
    turnId: record.turnId,
    createdAt: record.createdAt,
  };
}

function correlationId(activity: OrchestrationThreadActivity): string | undefined {
  if (typeof activity.payload !== "object" || activity.payload === null) return undefined;
  const payload = activity.payload as Record<string, unknown>;
  const value = payload.invocationId ?? payload.harnessInvocationId;
  return typeof value === "string" ? value : undefined;
}

export function mergeHarnessInvocationActivities(
  projected: ReadonlyArray<OrchestrationThreadActivity>,
  recovered: ReadonlyArray<HarnessInvocationRecord>,
): OrchestrationThreadActivity[] {
  const projectedIds = new Set(projected.map((activity) => String(activity.id)));
  const projectedInvocationIds = new Set(projected.flatMap((activity) => {
    const id = correlationId(activity);
    return id ? [id] : [];
  }));
  const synthetic = recovered
    .map(harnessInvocationActivity)
    .filter((activity) => !projectedIds.has(String(activity.id)) && !projectedInvocationIds.has(correlationId(activity) ?? ""));
  if (synthetic.length === 0) return [...projected];
  const orderedSynthetic = synthetic.toSorted(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || String(left.id).localeCompare(String(right.id)),
  );
  // Projection rows already carry the event sequence ordering used by the transcript.
  // Keep that authoritative order intact and append only recovered rows, whose order is
  // deterministic from their durable creation time and stable id.
  return [...projected, ...orderedSynthetic];
}

export { targetLabel, stateLabel };
