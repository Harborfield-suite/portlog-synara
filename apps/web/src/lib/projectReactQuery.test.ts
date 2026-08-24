import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    },
  });
});

import {
  isLocalPreviewGrantUsable,
  LOCAL_PREVIEW_GRANT_MAX_REFETCH_INTERVAL_MS,
  localPreviewGrantRefetchIntervalMs,
  projectDiscoverScriptsQueryOptions,
  projectListDirectoriesQueryOptions,
  projectReadFileQueryOptions,
  projectResolveOutOfRootFileReferenceQueryOptions,
  projectSearchEntriesQueryOptions,
  projectSearchLocalEntriesQueryOptions,
  projectLocalPreviewGrantQueryOptions,
} from "./projectReactQuery";
import { usePortLogWorkspaceStore } from "~/portlog/portlogWorkspaceStore";

afterEach(() => {
  usePortLogWorkspaceStore.setState({ activeProjectId: null, workspacesByProjectId: {} });
  delete (globalThis as { window?: unknown }).window;
});

describe("PortLog query routing", () => {
  it("keeps registered PortLog workspaces off the NativeApi path", async () => {
    const workspace = { projectId: "project-1", root: "/portlog", name: "PortLog" };
    const listWorkspace = vi.fn(async ({ projectId }: { projectId: string }) => ({
      projectId,
      entries: [
        {
          locator: "workspace:project-1:main.ts",
          relativePath: "main.ts",
          name: "main.ts",
          kind: "file" as const,
          sizeBytes: 20,
        },
        {
          locator: "workspace:project-1:package.json",
          relativePath: "package.json",
          name: "package.json",
          kind: "file" as const,
          sizeBytes: 60,
        },
      ],
    }));
    const runtime = {
      openProject: vi.fn(async () => workspace),
      listWorkspace,
      readContent: vi.fn(async ({ locator }: { locator: string }) => ({
        locator,
        relativePath: locator.endsWith("main.ts") ? "main.ts" : "package.json",
        contents: locator.endsWith("main.ts") ? "" : JSON.stringify({ scripts: { test: "vitest" } }),
        offset: 0,
        totalBytes: 60,
        truncated: false,
      })),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
        desktopBridge: { portlogRuntime: runtime },
      },
    });
    usePortLogWorkspaceStore.setState({
      activeProjectId: workspace.projectId,
      workspacesByProjectId: { [workspace.projectId]: workspace },
    });

    const list = await projectListDirectoriesQueryOptions({ cwd: workspace.root }).queryFn?.(
      {} as never,
    );
    const read = await projectReadFileQueryOptions({
      cwd: workspace.root,
      relativePath: "main.ts",
    }).queryFn?.({} as never);
    const searched = await projectSearchEntriesQueryOptions({
      cwd: workspace.root,
      query: "main",
    }).queryFn?.({} as never);
    const scripts = await projectDiscoverScriptsQueryOptions({ cwd: workspace.root }).queryFn?.(
      {} as never,
    );
    const local = await projectSearchLocalEntriesQueryOptions({
      rootPath: workspace.root,
      query: "main",
    }).queryFn?.({} as never);
    const outOfRoot = await projectResolveOutOfRootFileReferenceQueryOptions({
      cwd: workspace.root,
      relativePath: "outside.txt",
    }).queryFn?.({} as never);

    expect(list?.entries[0]?.path).toBe("main.ts");
    expect(read?.contents).toBe("");
    expect(searched?.entries).toEqual([{ path: "main.ts", kind: "file" }]);
    expect(scripts?.targets[0]?.scripts).toEqual([{ name: "test", command: "npm run test" }]);
    expect(local?.entries[0]).toMatchObject({ path: "main.ts", name: "main.ts", kind: "file" });
    expect(outOfRoot).toEqual({ fullPath: null });
    expect(runtime.openProject).not.toHaveBeenCalled();
    expect(listWorkspace).toHaveBeenCalled();
  });

  it("retains the NativeApi fallback for unregistered roots", async () => {
    const listDirectories = vi.fn(async () => ({ entries: [] }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
        nativeApi: { projects: { listDirectories } },
      },
    });

    const result = await projectListDirectoriesQueryOptions({ cwd: "/generic" }).queryFn?.(
      {} as never,
    );

    expect(result).toEqual({ entries: [] });
    expect(listDirectories).toHaveBeenCalledWith({
      cwd: "/generic",
      includeFiles: true,
    });
  });
});

describe("local preview grant query options", () => {
  it("refreshes active preview grants before the server-side token expires", () => {
    const nowMs = Date.UTC(2026, 0, 1, 0, 0, 0);

    expect(
      localPreviewGrantRefetchIntervalMs(
        { expiresAt: new Date(nowMs + 120_000).toISOString() },
        nowMs,
      ),
    ).toBe(LOCAL_PREVIEW_GRANT_MAX_REFETCH_INTERVAL_MS);
    expect(
      localPreviewGrantRefetchIntervalMs(
        { expiresAt: new Date(nowMs + 20_000).toISOString() },
        nowMs,
      ),
    ).toBe(5_000);
    expect(
      localPreviewGrantRefetchIntervalMs(
        { expiresAt: new Date(nowMs - 1_000).toISOString() },
        nowMs,
      ),
    ).toBe(1_000);
  });

  it("does not treat expired cached grants as usable preview URLs", () => {
    const nowMs = Date.UTC(2026, 0, 1, 0, 0, 0);

    expect(
      isLocalPreviewGrantUsable({ expiresAt: new Date(nowMs + 2_000).toISOString() }, nowMs),
    ).toBe(true);
    expect(
      isLocalPreviewGrantUsable({ expiresAt: new Date(nowMs + 500).toISOString() }, nowMs),
    ).toBe(false);
  });

  it("wires the refresh interval into the React Query options", () => {
    const options = projectLocalPreviewGrantQueryOptions({ path: "/Users/me/Downloads/shot.png" });
    const refetchInterval = options.refetchInterval;

    expect(typeof refetchInterval).toBe("function");
    if (typeof refetchInterval !== "function") {
      throw new Error("Expected refetchInterval to be a function.");
    }
    expect(
      refetchInterval({
        state: { data: { grant: "grant-token", expiresAt: "not-a-date" } },
      } as never),
    ).toBe(LOCAL_PREVIEW_GRANT_MAX_REFETCH_INTERVAL_MS);
  });
});
