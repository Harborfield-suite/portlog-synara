import type { PortLogRuntimeProject } from "@synara/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface PortLogWorkspaceRecord extends PortLogRuntimeProject {
  readonly name: string;
}

interface PortLogWorkspaceStore {
  activeProjectId: string | null;
  workspacesByProjectId: Record<string, PortLogWorkspaceRecord>;
  openWorkspace: (workspace: PortLogRuntimeProject, name: string) => void;
  clearWorkspace: (projectId: string) => void;
}

export const usePortLogWorkspaceStore = create<PortLogWorkspaceStore>()(
  persist(
    (set) => ({
      activeProjectId: null,
      workspacesByProjectId: {},
      openWorkspace: (workspace, name) =>
        set((state) => ({
          activeProjectId: workspace.projectId,
          workspacesByProjectId: {
            ...state.workspacesByProjectId,
            [workspace.projectId]: { ...workspace, name },
          },
        })),
      clearWorkspace: (projectId) =>
        set((state) => {
          const next = { ...state.workspacesByProjectId };
          delete next[projectId];
          return {
            activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
            workspacesByProjectId: next,
          };
        }),
    }),
    {
      name: "portlog:workspace:v1",
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? undefined : window.localStorage,
      ),
      partialize: (state) => ({
        activeProjectId: state.activeProjectId,
        workspacesByProjectId: state.workspacesByProjectId,
      }),
    },
  ),
);

export function getPortLogWorkspaceByRoot(root: string): PortLogWorkspaceRecord | null {
  return (
    Object.values(usePortLogWorkspaceStore.getState().workspacesByProjectId).find(
      (workspace) => workspace.root === root,
    ) ?? null
  );
}
