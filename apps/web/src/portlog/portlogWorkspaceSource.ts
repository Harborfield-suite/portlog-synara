import type {
  PortLogRuntimeContentReadResult,
  PortLogRuntimeProject,
  PortLogRuntimeWorkspaceEntry,
  ProjectDiscoverScriptsResult,
  ProjectEntry,
  ProjectSearchEntriesResult,
  ProjectWriteFileResult,
} from "@synara/contracts";

import { getPortLogRuntimeClient, type PortLogRuntimeClient } from "./portlogRuntimeClient";

export type PortLogWorkspace = PortLogRuntimeProject;

export interface PortLogWorkspaceSource {
  open(root: string, options?: { readonly createIfMissing?: boolean }): Promise<PortLogWorkspace>;
  list(
    workspace: PortLogWorkspace,
    relativePath?: string,
    includeFiles?: boolean,
  ): Promise<ReadonlyArray<PortLogRuntimeWorkspaceEntry>>;
  readFile(
    workspace: PortLogWorkspace,
    relativePath: string,
  ): Promise<PortLogRuntimeContentReadResult>;
  searchEntries(
    workspace: PortLogWorkspace,
    query: string,
    limit: number,
    kind?: ProjectEntry["kind"],
  ): Promise<ProjectSearchEntriesResult>;
  discoverScripts(
    workspace: PortLogWorkspace,
    depth?: number,
  ): Promise<ProjectDiscoverScriptsResult>;
  writeFile(
    workspace: PortLogWorkspace,
    relativePath: string,
    contents: string,
    expectedVersion?: string | null,
  ): Promise<ProjectWriteFileResult>;
}

const MAX_SEARCH_DIRECTORIES = 512;
const MAX_SCRIPT_TARGETS = 80;
const DEFAULT_SCRIPT_DISCOVERY_DEPTH = 2;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const SEARCH_SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".cache",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Workspace file '${relativePath}' was not found.`);
  }
  return normalized;
}

function joinWorkspacePath(root: string, relativePath: string): string {
  if (!relativePath) return root;
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/u, "")}${separator}${relativePath.split("/").join(separator)}`;
}

function parsePackageScripts(
  contents: string,
  packageDirectory: string,
  workspace: PortLogWorkspace,
  packageJsonPath: string,
  manager: "bun" | "pnpm" | "yarn" | "npm",
) {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!record.scripts || typeof record.scripts !== "object" || Array.isArray(record.scripts)) {
      return null;
    }
    const scripts = Object.entries(record.scripts)
      .flatMap(([name, command]) =>
        typeof command === "string" && name.trim() && command.trim()
          ? [
              {
                name: name.trim(),
                command:
                  manager === "yarn"
                    ? `yarn ${name.trim()}`
                    : `${manager} run ${name.trim()}`,
              },
            ]
          : [],
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    if (scripts.length === 0) return null;
    const packageName =
      typeof record.name === "string" && record.name.trim() ? record.name.trim() : undefined;
    return {
      cwd: joinWorkspacePath(workspace.root, packageDirectory),
      relativePath: packageDirectory,
      packageJsonPath,
      ...(packageName ? { packageName } : {}),
      scripts,
    };
  } catch {
    return null;
  }
}

type PortLogWorkspaceClient = Pick<
  PortLogRuntimeClient,
  "openProject" | "listWorkspace" | "readContent"
> & {
  readonly writeContent?: PortLogRuntimeClient["writeContent"];
};

export function createPortLogWorkspaceSource(
  client: PortLogWorkspaceClient,
): PortLogWorkspaceSource {
  const list = async (
    workspace: PortLogWorkspace,
    relativePath?: string,
    includeFiles = true,
  ) => {
    const result = await client.listWorkspace({
      projectId: workspace.projectId,
      ...(relativePath ? { relativePath } : {}),
      includeFiles,
    });
    return result.entries;
  };

  return {
    open: (root, options) =>
      client.openProject({
        root,
        ...(options?.createIfMissing ? { createIfMissing: true } : {}),
      }),
    list,
    searchEntries: async (workspace, query, limit, kind) => {
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const entries: ProjectEntry[] = [];
      const pendingDirectories = [""];
      let visitedDirectories = 0;
      let truncated = false;

      while (pendingDirectories.length > 0) {
        if (visitedDirectories >= MAX_SEARCH_DIRECTORIES) {
          truncated = true;
          break;
        }
        const relativePath = pendingDirectories.shift() ?? "";
        visitedDirectories += 1;
        const children = await list(workspace, relativePath, true);
        for (const child of children) {
          if (child.kind === "directory") {
            if (!SEARCH_SKIPPED_DIRECTORIES.has(child.name)) {
              pendingDirectories.push(child.relativePath);
            }
          }
          if (
            (kind === undefined || child.kind === kind) &&
            child.relativePath.toLocaleLowerCase().includes(normalizedQuery)
          ) {
            const separator = child.relativePath.lastIndexOf("/");
            entries.push({
              path: child.relativePath,
              kind: child.kind,
              ...(separator >= 0 ? { parentPath: child.relativePath.slice(0, separator) } : {}),
            });
            if (entries.length >= limit) {
              truncated = true;
              break;
            }
          }
        }
        if (truncated) break;
      }

      return { entries, truncated: truncated || pendingDirectories.length > 0 };
    },
    discoverScripts: async (workspace, depth = DEFAULT_SCRIPT_DISCOVERY_DEPTH) => {
      const targets: Array<ProjectDiscoverScriptsResult["targets"][number]> = [];
      const pendingDirectories = [{ relativePath: "", depth: 0 }];
      const maxDepth = Math.max(0, Math.min(3, Math.floor(depth)));

      while (pendingDirectories.length > 0 && targets.length < MAX_SCRIPT_TARGETS) {
        const current = pendingDirectories.shift();
        if (!current) break;
        const children = await list(workspace, current.relativePath, true);
        const packageJson = children.find(
          (entry) => entry.kind === "file" && entry.name === "package.json",
        );
        if (packageJson && (packageJson.sizeBytes === undefined || packageJson.sizeBytes <= MAX_PACKAGE_JSON_BYTES)) {
          const packageDirectory = current.relativePath;
          const packageJsonPath = joinWorkspacePath(workspace.root, packageJson.relativePath);
          const packageContents = await client.readContent({ locator: packageJson.locator });
          const manager = children.some(
            (entry) => entry.name === "bun.lock" || entry.name === "bun.lockb",
          )
            ? "bun"
            : children.some((entry) => entry.name === "pnpm-lock.yaml")
              ? "pnpm"
              : children.some((entry) => entry.name === "yarn.lock")
                ? "yarn"
                : "npm";
          const target = parsePackageScripts(
            packageContents.contents,
            packageDirectory,
            workspace,
            packageJsonPath,
            manager,
          );
          if (target) targets.push(target);
        }
        if (current.depth >= maxDepth) continue;
        for (const child of children) {
          if (child.kind === "directory" && !SEARCH_SKIPPED_DIRECTORIES.has(child.name)) {
            pendingDirectories.push({
              relativePath: child.relativePath,
              depth: current.depth + 1,
            });
          }
        }
      }

      return {
        targets: targets.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
      };
    },
    readFile: async (workspace, inputPath) => {
      const relativePath = normalizeRelativePath(inputPath);
      const separator = relativePath.lastIndexOf("/");
      const parentPath = separator >= 0 ? relativePath.slice(0, separator) : undefined;
      const entries = await list(workspace, parentPath, true);
      const entry = entries.find((candidate) => candidate.relativePath === relativePath);
      if (!entry || entry.kind !== "file") {
        throw new Error(`Workspace file '${inputPath}' was not found.`);
      }
      return client.readContent({ locator: entry.locator });
    },
    writeFile: async (workspace, inputPath, contents, expectedVersion) => {
      const writeContent = client.writeContent;
      if (!writeContent) throw new Error("PortLog content writes are unavailable.");
      const relativePath = normalizeRelativePath(inputPath);
      return writeContent({
        projectId: workspace.projectId,
        relativePath,
        contents,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      });
    },
  };
}

export function getPortLogWorkspaceSource(): PortLogWorkspaceSource | null {
  const client = getPortLogRuntimeClient();
  return client ? createPortLogWorkspaceSource(client) : null;
}
