import "../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { PortLogRuntimeClient } from "./portlogRuntimeClient";
import { PortLogRuntimeChatPanel } from "./PortLogRuntimeChatPanel";

const runtimeEvent = {
  streamId: "stream-1",
  cursor: 1,
  sessionId: "session-1",
  turnId: "turn-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  type: "user.message",
  text: "Inspect the fixture.",
} as const;

function createRuntimeClient(activeTurnId?: string): {
  client: PortLogRuntimeClient;
  cancelTurn: ReturnType<typeof vi.fn>;
} {
  const cancelTurn = vi.fn(async () => ({ accepted: true as const }));
  return {
    client: {
    getStatus: async () => ({ status: "ready", ready: null, error: null }),
    health: async () => ({ healthy: true, status: "ready", runtimeInstanceId: "runtime-1" }),
    listModels: async () => [
      {
        ref: "openrouter/deepseek/deepseek-v4-flash",
        providerId: "openrouter",
        providerLabel: "OpenRouter",
        modelLabel: "DeepSeek V4 Flash",
        status: "ready",
      },
    ],
    openProject: async () => ({ projectId: "project-1", root: "/tmp/project" }),
    describeProject: async () => ({ projectId: "project-1", root: "/tmp/project", name: "Project" }),
    listWorkspace: async () => ({ entries: [] }),
    listArtifacts: async () => [],
    describeArtifact: async () => {
      throw new Error("not used");
    },
    readContent: async () => ({ content: "", version: "version-1" }),
    writeContent: async () => ({ version: "version-1", relativePath: "fixture.txt" }),
    recordEvidence: async () => {
      throw new Error("not used");
    },
    getEvidence: async () => {
      throw new Error("not used");
    },
    listEvidence: async () => [],
    recordFinding: async () => {
      throw new Error("not used");
    },
    listFindings: async () => [],
    createSession: async () => ({ sessionId: "session-1", projectId: "project-1", modelRef: runtimeEvent.streamId }),
    sendTurn: async () => ({ accepted: true }),
    cancelTurn,
    attachSession: async () => ({
      sessionId: "session-1",
      streamId: "stream-1",
      cursor: activeTurnId ? 2 : 1,
      state: activeTurnId ? "active" : "idle",
      ...(activeTurnId ? { activeTurnId } : {}),
      events: activeTurnId
        ? [
            runtimeEvent,
            {
              ...runtimeEvent,
              cursor: 2,
              type: "assistant.delta",
              delta: "Working…",
              createdAt: "2026-01-01T00:00:01.000Z",
            },
          ]
        : [runtimeEvent],
    }),
    sessionHistory: async () => ({ sessionId: "session-1", offset: 0, limit: 20, hasMore: false, turns: [] }),
    onEvent: () => () => undefined,
    } as unknown as PortLogRuntimeClient,
    cancelTurn,
  };
}

describe("PortLogRuntimeChatPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "portlog-runtime-session:/tmp/project",
      JSON.stringify({ projectId: "project-1", sessionId: "session-1" }),
    );
    vi.stubGlobal("desktopBridge", {
      setTheme: async () => undefined,
      portlogRuntime: createRuntimeClient().client,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("uses Synara's transcript shell and composer shell for recovered runtime history", async () => {
    await render(
      <PortLogRuntimeChatPanel workspaceRoot="/tmp/project" onOpenEvidence={() => undefined} />,
    );

    await expect.element(page.getByTestId("portlog-runtime-chat")).toBeVisible();
    await expect.element(page.getByText("Inspect the fixture.")).toBeVisible();
    await expect.element(page.getByTestId("portlog-composer-form")).toBeVisible();
    expect(
      page.getByTestId("portlog-runtime-chat").element().querySelector('[contenteditable="true"]'),
    ).not.toBeNull();
    expect(
      page.getByTestId("portlog-runtime-chat").element().querySelector('[data-chat-transcript-pane="true"]'),
    ).not.toBeNull();
    const chat = page.getByTestId("portlog-runtime-chat").element();
    expect(chat.querySelector('[data-chat-scroll-container="true"]')).not.toBeNull();
    expect(chat.querySelectorAll('[class*="max-w-none"]').length).toBeGreaterThan(0);
  });

  it("keeps the Synara composer disabled and exposes runtime cancellation during an active turn", async () => {
    const harness = createRuntimeClient("turn-1");
    vi.stubGlobal("desktopBridge", {
      setTheme: async () => undefined,
      portlogRuntime: harness.client,
    });

    await render(
      <PortLogRuntimeChatPanel workspaceRoot="/tmp/project" onOpenEvidence={() => undefined} />,
    );

    await expect.element(page.getByLabelText("Cancel turn")).toBeVisible();
    expect(page.getByTestId("composer-editor").element().getAttribute("contenteditable")).toBe("false");
    await page.getByLabelText("Cancel turn").click();
    expect(harness.cancelTurn).toHaveBeenCalledWith({ sessionId: "session-1", turnId: "turn-1" });
  });
});
