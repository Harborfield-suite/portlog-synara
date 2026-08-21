import { describe, expect, it } from "vitest";
import { InvocationId, ThreadId, TurnId } from "@synara/contracts";
import type { HarnessInvocationRecord } from "@synara/contracts";
import { harnessInvocationActivity, mergeHarnessInvocationActivities } from "./harnessInvocationActivity.ts";

const record = (state: HarnessInvocationRecord["state"], id = "inv-1"): HarnessInvocationRecord => ({
  invocationId: InvocationId.makeUnsafe(id),
  threadId: ThreadId.makeUnsafe("thread-1"),
  turnId: TurnId.makeUnsafe("turn-1"),
  target: { kind: "tool", toolName: "read_file", deterministic: false },
  state,
  currentAttempt: 2,
  checkpoint: null,
  result: state === "completed" ? { ok: true } : null,
  error: state === "failed" ? { class: "execution", message: "failed", retryable: true } : null,
  createdAt: `2026-08-10T00:00:0${id === "inv-1" ? "1" : "2"}.000Z`,
  updatedAt: "2026-08-10T00:00:03.000Z",
  completedAt: state === "completed" ? "2026-08-10T00:00:03.000Z" : null,
});

describe("harness invocation activity projection", () => {
  it.each(["running", "completed", "failed", "unknown", "interrupted", "cancelled"] as const)(
    "preserves %s state in the activity",
    (state) => {
      const activity = harnessInvocationActivity(record(state));
      expect(activity.kind).toBe("harness.invocation");
      expect(activity.id).toBe("harness-invocation:inv-1");
      expect(activity.summary).toContain(state);
      expect(activity.payload).toMatchObject({ invocationId: "inv-1", state, currentAttempt: 2 });
    },
  );

  it("prefers projected activities and orders recovered rows deterministically", () => {
    const projected = [{
      ...harnessInvocationActivity(record("running")),
      summary: "projected running",
    }];
    const merged = mergeHarnessInvocationActivities(projected, [record("completed"), record("failed", "inv-2")]);
    expect(merged.map((item) => item.id)).toEqual([
      "harness-invocation:inv-1",
      "harness-invocation:inv-2",
    ]);
    expect(merged[0]?.summary).toBe("projected running");
  });
  it("prefers a projected correlated activity even when its kind differs", () => {
    const projected = [{
      ...harnessInvocationActivity(record("running")),
      kind: "tool.completed",
      payload: { invocationId: "inv-1" },
    }];
    expect(mergeHarnessInvocationActivities(projected, [record("completed")])).toHaveLength(1);
    expect(mergeHarnessInvocationActivities(projected, [record("completed")])[0]?.kind).toBe("tool.completed");
  });

  it("enforces a global bound on broad durable details", () => {
    const wide = { ...record("completed"), result: Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`very-long-key-${index}-${"x".repeat(200)}`, { nested: "y".repeat(4_000) }])) };
    const activity = harnessInvocationActivity(wide);
    expect(JSON.stringify(activity.payload).length).toBeLessThanOrEqual(12_000);
    expect(activity.payload).toMatchObject({ detailTruncated: true, result: "[truncated]" });
  });

  it("keeps the fallback budget when the target is oversized", () => {
    const oversizedTarget = { ...record("running"), target: { kind: "tool", toolName: "read", ...Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`extra-${index}`, "z".repeat(400)])) } as HarnessInvocationRecord["target"] };
    const activity = harnessInvocationActivity(oversizedTarget);
    expect(JSON.stringify(activity.payload).length).toBeLessThanOrEqual(12_000);
    expect(activity.payload).toMatchObject({ detailTruncated: true });
  });

});
