// FILE: ChatHeader.test.tsx
// Purpose: Covers chat header presentation helpers and direct surface actions.
// Layer: Component rendering tests
// Depends on: ChatHeader, shared query/sidebar providers, and Vitest assertions.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThreadId } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatHeader, resolveChatHeaderThreadIconKind } from "./ChatHeader";
import { SidebarProvider } from "../ui/sidebar";

describe("ChatHeader direct editor action", () => {
  it("keeps provider handoff as a direct header action", () => {
    const queryClient = new QueryClient();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <ChatHeader
            activeThreadId={ThreadId.makeUnsafe("thread-1")}
            activeThreadTitle="Fix the parser"
            activeThreadEntryPoint="chat"
            activeProvider="codex"
            activeProjectName="project"
            threadBreadcrumbs={[]}
            isGitRepo={false}
            openInTarget={null}
            activeProjectScripts={undefined}
            preferredScriptId={null}
            keybindings={[]}
            availableEditors={[]}
            diffToggleShortcutLabel={null}
            handoffBadgeLabel={null}
            handoffActionLabel="Hand off thread"
            handoffDisabled={false}
            handoffActionTargetProviders={["claudeAgent"]}
            handoffBadgeSourceProvider={null}
            handoffBadgeTargetProvider={null}
            gitCwd={null}
            diffTotals={{ additions: 0, deletions: 0, fileCount: 0, hasChanges: false }}
            showGitActions={false}
            showDiffToggle={false}
            diffOpen={false}
            onToggleDiff={vi.fn()}
            onRunProjectScript={vi.fn()}
            onAddProjectScript={vi.fn()}
            onUpdateProjectScript={vi.fn()}
            onDeleteProjectScript={vi.fn()}
            onCreateHandoff={vi.fn()}
            onNavigateToThread={vi.fn()}
            onRenameThread={vi.fn()}
          />
        </SidebarProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain('aria-label="Hand off thread"');
  });

  it("renders the editor view action without requiring the environment menu", () => {
    const queryClient = new QueryClient();
    const onOpenEditorView = vi.fn();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <ChatHeader
            activeThreadId={ThreadId.makeUnsafe("thread-1")}
            activeThreadTitle="Fix the parser"
            activeThreadEntryPoint="chat"
            activeProvider="codex"
            activeProjectName="project"
            threadBreadcrumbs={[]}
            isGitRepo={false}
            openInTarget={null}
            activeProjectScripts={undefined}
            preferredScriptId={null}
            keybindings={[]}
            availableEditors={[]}
            diffToggleShortcutLabel={null}
            handoffBadgeLabel={null}
            handoffActionLabel="Hand off"
            handoffDisabled={true}
            handoffActionTargetProviders={[]}
            handoffBadgeSourceProvider={null}
            handoffBadgeTargetProvider={null}
            gitCwd={null}
            diffTotals={{ additions: 0, deletions: 0, fileCount: 0, hasChanges: false }}
            showGitActions={false}
            showDiffToggle={false}
            diffOpen={false}
            viewModeAction={{
              label: "Editor view",
              active: false,
              onClick: onOpenEditorView,
            }}
            onToggleDiff={vi.fn()}
            onRunProjectScript={vi.fn()}
            onAddProjectScript={vi.fn()}
            onUpdateProjectScript={vi.fn()}
            onDeleteProjectScript={vi.fn()}
            onCreateHandoff={vi.fn()}
            onNavigateToThread={vi.fn()}
            onRenameThread={vi.fn()}
          />
        </SidebarProvider>
      </QueryClientProvider>,
    );

    expect(markup).toContain('aria-label="Editor view"');
    expect(markup).toContain(">Editor</span>");
    expect(markup).not.toContain("Environment");
  });
});

describe("resolveChatHeaderThreadIconKind", () => {
  it("uses the terminal icon for terminal-first threads", () => {
    expect(resolveChatHeaderThreadIconKind("terminal", "New terminal")).toBe("terminal");
  });

  it("keeps provider branding for chat-first threads", () => {
    expect(resolveChatHeaderThreadIconKind("chat", "Fix auth flow")).toBe("provider");
  });

  it("hides provider branding for untouched new chat threads", () => {
    expect(resolveChatHeaderThreadIconKind("chat", "New thread")).toBe("none");
  });
});
