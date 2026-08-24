import { describe, expect, it, vi } from "vitest";

import type { PortLogRuntimeClient } from "./portlogRuntimeClient";
import { createPortLogWorkspaceSource } from "./portlogWorkspaceSource";

describe("PortLogWorkspaceSource", () => {
  it("opens a project, lists its entries, and reads a file through its locator", async () => {
    const calls: string[] = [];
    const client: Pick<PortLogRuntimeClient, "openProject" | "listWorkspace" | "readContent"> = {
      openProject: async ({ root }) => {
        calls.push(`open:${root}`);
        return { projectId: "project-1", root };
      },
      listWorkspace: async ({ projectId, relativePath }) => {
        calls.push(`list:${projectId}:${relativePath ?? ""}`);
        return {
          projectId,
          entries: [
            {
              locator: "workspace:project-1:input%2Fplant.svg",
              relativePath: "input/plant.svg",
              name: "plant.svg",
              kind: "file",
            },
          ],
        };
      },
      readContent: async ({ locator }) => {
        calls.push(`read:${locator}`);
        return {
          locator,
          relativePath: "input/plant.svg",
          contents: "<svg />",
          offset: 0,
          totalBytes: 8,
          truncated: false,
        };
      },
    };

    const source = createPortLogWorkspaceSource(client);
    const workspace = await source.open("/tmp/plant");
    const entries = await source.list(workspace, "input");
    const file = await source.readFile(workspace, "input/plant.svg");

    expect(entries[0]?.relativePath).toBe("input/plant.svg");
    expect(file.contents).toBe("<svg />");
    expect(calls).toEqual([
      "open:/tmp/plant",
      "list:project-1:input",
      "list:project-1:input",
      "read:workspace:project-1:input%2Fplant.svg",
    ]);
  });

  it("searches nested workspace entries through the PortLog list protocol", async () => {
    const listedPaths: string[] = [];
    const client: Pick<PortLogRuntimeClient, "openProject" | "listWorkspace" | "readContent"> = {
      openProject: async ({ root }) => ({ projectId: "project-1", root }),
      listWorkspace: async ({ projectId, relativePath }) => {
        const path = relativePath ?? "";
        listedPaths.push(path);
        const entries = path === ""
          ? [
              {
                locator: "workspace:project-1:src",
                relativePath: "src",
                name: "src",
                kind: "directory" as const,
              },
              {
                locator: "workspace:project-1:node_modules",
                relativePath: "node_modules",
                name: "node_modules",
                kind: "directory" as const,
              },
            ]
          : [
              {
                locator: "workspace:project-1:src/main.ts",
                relativePath: "src/main.ts",
                name: "main.ts",
                kind: "file" as const,
              },
            ];
        return { projectId, entries };
      },
      readContent: async () => {
        throw new Error("not used");
      },
    };

    const source = createPortLogWorkspaceSource(client);
    const workspace = await source.open("/tmp/plant");
    const result = await source.searchEntries(workspace, "MAIN", 10, "file");

    expect(result).toEqual({
      entries: [{ path: "src/main.ts", kind: "file", parentPath: "src" }],
      truncated: false,
    });
    expect(listedPaths).toEqual(["", "src"]);
  });

  it("discovers package scripts through workspace reads", async () => {
    const client: Pick<PortLogRuntimeClient, "openProject" | "listWorkspace" | "readContent"> = {
      openProject: async ({ root }) => ({ projectId: "project-1", root }),
      listWorkspace: async ({ projectId, relativePath }) => ({
        projectId,
        entries: (relativePath ?? "") === ""
          ? [
              {
                locator: "workspace:project-1:package.json",
                relativePath: "package.json",
                name: "package.json",
                kind: "file" as const,
                sizeBytes: 80,
              },
              {
                locator: "workspace:project-1:bun.lock",
                relativePath: "bun.lock",
                name: "bun.lock",
                kind: "file" as const,
                sizeBytes: 10,
              },
              {
                locator: "workspace:project-1:apps",
                relativePath: "apps",
                name: "apps",
                kind: "directory" as const,
              },
            ]
          : relativePath === "apps"
            ? [
                {
                  locator: "workspace:project-1:apps/web",
                  relativePath: "apps/web",
                  name: "web",
                  kind: "directory" as const,
                },
              ]
            : [
                {
                  locator: "workspace:project-1:apps/web/package.json",
                  relativePath: "apps/web/package.json",
                  name: "package.json",
                  kind: "file" as const,
                  sizeBytes: 80,
                },
              ],
      }),
      readContent: async ({ locator }) => ({
        locator,
        relativePath: locator.includes("apps/web/") ? "apps/web/package.json" : "package.json",
        contents: locator.includes("apps/web/")
          ? JSON.stringify({ scripts: { test: "vitest" } })
          : JSON.stringify({ name: "root", scripts: { dev: "vite" } }),
        offset: 0,
        totalBytes: 80,
        truncated: false,
      }),
    };

    const source = createPortLogWorkspaceSource(client);
    const workspace = await source.open("/tmp/plant");
    const result = await source.discoverScripts(workspace);

    expect(result.targets).toEqual([
      {
        cwd: "/tmp/plant",
        relativePath: "",
        packageJsonPath: "/tmp/plant/package.json",
        packageName: "root",
        scripts: [{ name: "dev", command: "bun run dev" }],
      },
      {
        cwd: "/tmp/plant/apps/web",
        relativePath: "apps/web",
        packageJsonPath: "/tmp/plant/apps/web/package.json",
        scripts: [{ name: "test", command: "npm run test" }],
      },
    ]);
  });

  it("writes through the PortLog content protocol", async () => {
    const writeContent = vi.fn(async (input: {
      projectId: string;
      relativePath: string;
      contents: string;
      expectedVersion?: string | null;
    }) => ({
      projectId: input.projectId,
      relativePath: input.relativePath,
      version: "sha256:next",
    }));
    const client: Pick<PortLogRuntimeClient, "openProject" | "listWorkspace" | "readContent"> & {
      writeContent: typeof writeContent;
    } = {
      openProject: async ({ root }) => ({ projectId: "project-1", root }),
      listWorkspace: async () => ({ projectId: "project-1", entries: [] }),
      readContent: async () => {
        throw new Error("not used");
      },
      writeContent,
    };

    const source = createPortLogWorkspaceSource(client);
    const workspace = await source.open("/tmp/plant");
    const result = await source.writeFile(workspace, "notes.md", "updated", "sha256:old");

    expect(result).toEqual({
      projectId: "project-1",
      relativePath: "notes.md",
      version: "sha256:next",
    });
    expect(writeContent).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePath: "notes.md",
      contents: "updated",
      expectedVersion: "sha256:old",
    });
  });

  it("rejects a path that is not a file in the workspace", async () => {
    const client: Pick<PortLogRuntimeClient, "openProject" | "listWorkspace" | "readContent"> = {
      openProject: async ({ root }) => ({ projectId: "project-1", root }),
      listWorkspace: async () => ({ projectId: "project-1", entries: [] }),
      readContent: async () => {
        throw new Error("should not read an unknown file");
      },
    };

    const source = createPortLogWorkspaceSource(client);
    const workspace = await source.open("/tmp/plant");

    await expect(source.readFile(workspace, "missing.txt")).rejects.toThrow(
      "Workspace file 'missing.txt' was not found.",
    );
  });
});
