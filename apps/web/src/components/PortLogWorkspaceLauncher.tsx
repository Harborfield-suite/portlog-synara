import type { ProjectId, SpaceId } from "@synara/contracts";
import { useMemo, useState } from "react";

import { useStore } from "../store";
import type { Project, Space } from "../types";
import {
  isDroppedComposerDirectory,
  resolveDroppedFileAbsolutePath,
} from "../lib/composerDropPaths";
import { createOrRecoverProjectFromPath } from "../lib/projectCreation";
import { readNativeApi } from "../nativeApi";
import {
  getPortLogWorkspaceSource,
  type PortLogWorkspace,
  type PortLogWorkspaceSource,
} from "../portlog/portlogWorkspaceSource";
import { CreateProjectDialog, type CreateProjectSubmitValue } from "./CreateProjectDialog";
import { Button } from "./ui/button";
import { CentralIcon } from "~/lib/central-icons";

function resolveRecentProjects(projects: readonly Project[]): Project[] {
  return projects
    .filter((project) => project.kind === "project")
    .slice()
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "") || 0;
      const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "") || 0;
      return rightTime - leftTime;
    })
    .slice(0, 5);
}

function projectMeta(project: Project): string {
  return project.cwd || project.folderName || "Workspace folder";
}

function parentDirectory(path: string): string {
  const normalized = path.replace(/\\/gu, "/").replace(/\/$/u, "");
  const separator = normalized.lastIndexOf("/");
  return separator > 0 ? normalized.slice(0, separator) : normalized;
}

function workspaceName(path: string): string {
  const normalized = path.replace(/\\/gu, "/").replace(/\/$/u, "");
  const separator = normalized.lastIndexOf("/");
  return separator >= 0 ? normalized.slice(separator + 1) || "Workspace" : normalized;
}

export function PortLogWorkspaceLauncher(props: {
  projects: readonly Project[];
  spaces: readonly Space[];
  activeSpaceId: SpaceId | null;
  homeDir: string | null;
  onOpenProject: (projectId: ProjectId) => void | Promise<void>;
  onOpenPortLogWorkspace?: (workspace: PortLogWorkspace, name: string) => void | Promise<void>;
  workspaceSource?: PortLogWorkspaceSource | null;
}) {
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [droppedWorkspaceRoot, setDroppedWorkspaceRoot] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const recentProjects = useMemo(() => resolveRecentProjects(props.projects), [props.projects]);

  const openPortLogWorkspace = async (
    root: string,
    name: string,
    options?: { readonly createIfMissing?: boolean },
  ): Promise<boolean> => {
    const source = props.workspaceSource ?? getPortLogWorkspaceSource();
    if (!source || !props.onOpenPortLogWorkspace) {
      return false;
    }
    const workspace = options ? await source.open(root, options) : await source.open(root);
    await props.onOpenPortLogWorkspace(workspace, name);
    return true;
  };

  const openRecentProject = async (project: Project) => {
    try {
      if (await openPortLogWorkspace(project.cwd, project.name)) {
        return;
      }
      await props.onOpenProject(project.id);
    } catch (cause: unknown) {
      setDropError(cause instanceof Error ? cause.message : "Could not open that workspace.");
    }
  };

  const openProjectDialog = () => {
    setDropError(null);
    setDroppedWorkspaceRoot(null);
    setCreateProjectDialogOpen(true);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const item = Array.from(event.dataTransfer.items).find((entry) => entry.kind === "file");
    const file = item?.getAsFile() ?? event.dataTransfer.files[0] ?? null;
    if (!item || !file) {
      setDropError("Drop a folder or document to open its workspace.");
      return;
    }
    const droppedPath = resolveDroppedFileAbsolutePath(file);
    if (!droppedPath) {
      setDropError("Could not read that item's path. Use Open folder instead.");
      return;
    }
    const workspaceRoot = isDroppedComposerDirectory(item)
      ? droppedPath
      : parentDirectory(droppedPath);
    setDropError(null);
    setDroppedWorkspaceRoot(workspaceRoot);
    setCreateProjectDialogOpen(true);
  };

  const handleProjectSubmit = async (
    value: CreateProjectSubmitValue,
    _options: { signal: AbortSignal },
  ) => {
    if (value.source !== "local") {
      throw new Error("GitHub projects can be added from the project sidebar.");
    }
    if (
      await openPortLogWorkspace(value.workspaceRoot, workspaceName(value.workspaceRoot), {
        createIfMissing: value.createIfMissing,
      })
    ) {
      return;
    }
    const api = readNativeApi();
    if (!api) {
      throw new Error("The app server is unavailable.");
    }
    const result = await createOrRecoverProjectFromPath({
      api,
      workspaceRoot: value.workspaceRoot,
      createIfMissing: value.createIfMissing,
      spaceId: value.spaceId,
      loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
    });
    if (result.snapshot) {
      syncServerShellSnapshot(result.snapshot);
    }
    await props.onOpenProject(result.projectId);
  };

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-background text-foreground"
      data-testid="portlog-workspace-launcher"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/65 px-5 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <CentralIcon name="folder-open" className="size-4 opacity-70" aria-hidden="true" />
          <span className="text-foreground">Workspace</span>
        </div>
        <span>PortLog</span>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col lg:flex-row">
        <section className="flex w-full flex-col border-b border-border/65 px-8 py-12 lg:w-[43%] lg:border-b-0 lg:border-r lg:px-14 lg:py-16">
          <div className="text-[length:var(--app-font-size-ui-xs,10px)] uppercase tracking-[0.16em] text-muted-foreground">
            Workspace
          </div>
          <h1 className="mt-5 max-w-md text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.04em] text-foreground">
            Open a plant
            <br />
            to continue.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">
            Work directly with the folders and documents you already have.
          </p>

          <div className="mt-10 flex flex-col gap-2" aria-label="Recent workspaces">
            {recentProjects.length > 0 ? (
              recentProjects.map((project, index) => (
                <button
                  key={project.id}
                  type="button"
                  className={`flex items-center justify-between rounded-lg px-4 py-3 text-left transition-colors duration-200 ease-out hover:bg-secondary ${index === 0 ? "border border-border bg-secondary/45" : ""}`}
                  onClick={() => void openRecentProject(project)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground">{project.name}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {projectMeta(project)}
                    </span>
                  </span>
                  <CentralIcon name="arrow-up-right" className="ml-4 size-4 shrink-0 opacity-60" aria-hidden="true" />
                </button>
              ))
            ) : (
              <p className="py-3 text-sm text-muted-foreground">No plant workspaces yet.</p>
            )}
          </div>
        </section>

        <section className="flex min-h-[28rem] flex-1 flex-col justify-center gap-4 px-8 py-12 lg:px-24 lg:py-16">
          <Button
            variant="default"
            size="xl"
            className="h-auto min-h-28 w-full justify-start px-7 py-6 text-left"
            onClick={openProjectDialog}
          >
            <span className="flex min-w-0 flex-col items-start gap-2">
              <span className="text-lg">Open folder</span>
              <span className="max-w-full font-normal text-primary-foreground/70">
                Work with an existing plant workspace in place.
              </span>
              <span className="mt-2 text-xs font-medium">Choose a folder →</span>
            </span>
          </Button>

          <div className="grid gap-4 sm:grid-cols-2">
            <Button
              variant="outline"
              size="xl"
              className="h-auto min-h-28 justify-start px-6 py-6 text-left"
              onClick={openProjectDialog}
            >
              <span className="flex min-w-0 flex-col items-start gap-2">
                <span className="text-base">New project</span>
                <span className="max-w-full font-normal text-muted-foreground">
                  Start a new plant workspace.
                </span>
              </span>
            </Button>
            <div
              className="flex min-h-28 cursor-pointer flex-col justify-center rounded-lg border border-dashed border-border px-6 py-6 text-left transition-colors duration-200 ease-out hover:bg-secondary/45"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              onClick={openProjectDialog}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") openProjectDialog();
              }}
            >
              <span className="text-base text-foreground">Drop documents</span>
              <span className="mt-2 max-w-full text-sm text-muted-foreground">
                Add an existing folder or document set.
              </span>
            </div>
          </div>
          {dropError ? <p className="text-xs text-destructive">{dropError}</p> : null}
          <p className="mt-8 text-xs text-muted-foreground">
            Nothing is uploaded. Your files stay where you put them.
          </p>
        </section>
      </main>

      <CreateProjectDialog
        open={createProjectDialogOpen}
        githubProvisioningAvailable={false}
        spaces={props.spaces}
        activeSpaceId={props.activeSpaceId}
        defaultCloneParent={props.homeDir ?? "~"}
        initialWorkspaceRoot={droppedWorkspaceRoot}
        onOpenChange={(open) => {
          setCreateProjectDialogOpen(open);
          if (!open) setDroppedWorkspaceRoot(null);
        }}
        onSubmit={handleProjectSubmit}
      />
    </div>
  );
}
