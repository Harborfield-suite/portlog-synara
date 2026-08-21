// FILE: _chat.index.tsx
// Purpose: Restores the last chat route on app launch, falling back to a fresh home-chat draft.
//          Also the landing for a Space that has nothing to open.
// Layer: Routing
// Depends on: the shared restore/create route surface plus the home-chat new-chat handler.

import { SpaceId, ThreadId, type ProjectId } from "@synara/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  RestoreOrCreateChatRoute,
  type RestoreRouteResolver,
} from "../components/RestoreOrCreateChatRoute";
import { readSidebarUiState } from "../components/Sidebar.uiState";
import { useComposerDraftStore } from "../composerDraftStore";
import { PortLogWorkspaceLauncher } from "../components/PortLogWorkspaceLauncher";
import { useHandleNewChat } from "../hooks/useHandleNewChat";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { VOID_SPACE_KEY } from "../lib/spaceGrouping";
import { collectStudioProjectIds } from "../lib/studioProjects";
import { resolveSplitViewThreadIds, useSplitViewStore } from "../splitViewStore";
import { EMPTY_THREAD_IDS, useStore } from "../store";
import { useWorkspacePathsStore } from "../workspacePathsStore";
import { useSpacesUiStore } from "../spacesUiStore";
import { resolveChatIndexRestoreRoute, type ChatIndexLandingSpace } from "./-chatIndexRoute.logic";

/**
 * Set by the Space switcher when the selected Space has nothing to open (`spaceKey`, so Void
 * survives as a string). It scopes the restore below to that Space — without it this landing
 * happily reopens the *previous* Space's thread, and the route-to-Space sync then writes that
 * Space back over the user's click.
 */
export interface ChatIndexSearch {
  readonly space?: string | undefined;
  readonly launcher?: boolean | undefined;
}

function ChatIndexRouteView() {
  const { handleNewChat } = useHandleNewChat();
  const { handleNewThread } = useHandleNewThread();
  const navigate = useNavigate();
  const landingSpaceKey = Route.useSearch({ select: (search) => search.space });
  const launcherRequested = Route.useSearch({ select: (search) => search.launcher === true });
  const threadIds = useStore((state) => state.threadIds ?? EMPTY_THREAD_IDS);
  const projects = useStore((state) => state.projects);
  const spaces = useStore((state) => state.spaces);
  const activeSpaceId = useSpacesUiStore((state) => state.activeSpaceId);
  const sidebarThreadSummaryById = useStore((state) => state.sidebarThreadSummaryById);
  const draftThreadsByThreadId = useComposerDraftStore((state) => state.draftThreadsByThreadId);
  const homeDir = useWorkspacePathsStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspacePathsStore((state) => state.chatWorkspaceRoot);
  const studioWorkspaceRoot = useWorkspacePathsStore((state) => state.studioWorkspaceRoot);
  // A Space landing reuses the stored home-chat draft instead of minting one (same reasoning as
  // the /studio landing): a fresh draft per visit would litter the Chats container every time
  // someone clicked through their empty Spaces.
  const createFreshChat = useCallback(
    () => (landingSpaceKey === undefined ? handleNewChat({ fresh: true }) : handleNewChat()),
    [handleNewChat, landingSpaceKey],
  );

  const openProject = useCallback(
    async (projectId: ProjectId) => {
      const existingThreadId = threadIds.find(
        (threadId) => sidebarThreadSummaryById[threadId]?.projectId === projectId,
      );
      if (existingThreadId) {
        await navigate({
          to: "/$threadId",
          params: { threadId: ThreadId.makeUnsafe(existingThreadId) },
          search: () => ({ view: "editor" }),
        });
        return;
      }
      await handleNewThread(
        projectId,
        { envMode: "local" },
        { search: () => ({ view: "editor" }) },
      );
    },
    [handleNewThread, navigate, sidebarThreadSummaryById, threadIds],
  );

  const renderWorkspaceLauncher = useCallback(
    () => (
      <PortLogWorkspaceLauncher
        projects={projects}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        homeDir={homeDir}
        onOpenProject={openProject}
      />
    ),
    [activeSpaceId, homeDir, openProject, projects, spaces],
  );

  const workspacePaths = { homeDir, chatWorkspaceRoot, studioWorkspaceRoot };
  // Home chats restore the last visited route, except Studio threads — those belong to the
  // /studio surface, and restoring one from "/" would silently switch the user into the Studio
  // segment. A Studio lastThreadRoute falls through to a fresh home-chat draft instead.
  const studioProjectIds = collectStudioProjectIds(projects, workspacePaths);
  // Only plain, still-unsent chat drafts qualify as restore targets: a non-"chat" entry point
  // isn't a home-chat draft, and `promotedTo` means the draft already became a real thread, so
  // its stale id is no longer valid (matches the filtering findStudioDraftThreadId applies).
  const draftProjectIdByThreadId = new Map<string, ProjectId>();
  for (const [threadId, draft] of Object.entries(draftThreadsByThreadId)) {
    if (draft.entryPoint === "chat" && draft.promotedTo === undefined) {
      draftProjectIdByThreadId.set(threadId, draft.projectId);
    }
  }

  const landingSpace: ChatIndexLandingSpace | null =
    landingSpaceKey === undefined
      ? null
      : {
          spaceId: landingSpaceKey === VOID_SPACE_KEY ? null : SpaceId.makeUnsafe(landingSpaceKey),
          projectById: new Map(projects.map((project) => [project.id, project])),
          workspacePaths,
        };

  const resolveRestoreRoute: RestoreRouteResolver = ({ availableSplitViewIds }) => {
    if (launcherRequested && landingSpaceKey === undefined) {
      return null;
    }
    const lastThreadRoute = readSidebarUiState().lastThreadRoute;
    const rememberedSplitView = lastThreadRoute?.splitViewId
      ? useSplitViewStore.getState().splitViewsById[lastThreadRoute.splitViewId]
      : undefined;
    return resolveChatIndexRestoreRoute({
      lastThreadRoute,
      availableSplitViewIds,
      threadIds,
      sidebarThreadSummaryById,
      studioProjectIds,
      draftProjectIdByThreadId,
      rememberedSplitViewThreadIds: rememberedSplitView
        ? resolveSplitViewThreadIds(rememberedSplitView)
        : undefined,
      landingSpace,
    });
  };

  return (
    <RestoreOrCreateChatRoute
      resolveRestoreRoute={resolveRestoreRoute}
      createFreshChat={createFreshChat}
      renderEmptyContent={
        launcherRequested && landingSpaceKey === undefined ? renderWorkspaceLauncher : undefined
      }
    />
  );
}

export const Route = createFileRoute("/_chat/")({
  validateSearch: (raw: Record<string, unknown>): ChatIndexSearch => ({
    ...(typeof raw.space === "string" && raw.space.length > 0 ? { space: raw.space } : {}),
    ...(raw.launcher === true ? { launcher: true } : {}),
  }),
  component: ChatIndexRouteView,
});
