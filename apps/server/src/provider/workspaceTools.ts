import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { AiSdkToolDefinition } from "./aiSdkChatClient.ts";
import { isContainedPath, resolveRealPathWithinRoot } from "../workspace/realPathContainment.ts";

const MAX_DIRECTORY_ENTRIES = 200;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_FILE_BYTES = 256 * 1024;
const MAX_SEARCH_DEPTH = 8;
const MAX_SEARCH_FILES = 2_000;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".next", ".turbo", "dist", "build"]);

function isSensitiveRelativePath(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]+/u).filter(Boolean).map((segment) => segment.toLowerCase());
  const basename = segments.at(-1) ?? "";
  if (segments.some((segment) => [".ssh", ".aws", ".kube", ".netrc", ".git-credentials"].includes(segment))) {
    return true;
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === ".config" && segments[index + 1] === "gcloud") return true;
  }
  return (
    basename === ".env" ||
    (basename.startsWith(".env.") && !basename.endsWith(".example")) ||
    basename === ".npmrc" ||
    basename === ".pypirc" ||
    basename === "credentials" ||
    basename === "credentials.json" ||
    basename === "service-account.json" ||
    basename === "service-account-key.json" ||
    basename === "auth.json" ||
    basename === "token.json" ||
    basename === "access_token.json" ||
    basename === "refresh_token.json" ||
    ["id_rsa", "id_ed25519", "id_ecdsa", "private_key"].includes(basename) ||
    basename.endsWith(".pem") ||
    basename.endsWith(".key") ||
    basename.endsWith(".p12") ||
    basename.endsWith(".pfx")
  );
}

function fail(message: string): never {
  throw new Error(message);
}

function relativeInput(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (path.isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/u.test(trimmed) || trimmed.startsWith("\\\\")) {
    fail(`${label} must be relative to the workspace.`);
  }
  const normalized = path.normalize(trimmed);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    fail(`${label} is outside the workspace.`);
  }
  return normalized;
}

async function resolveExisting(root: string, relativePath: string, kind: "file" | "directory" | "any") {
  const relative = relativeInput(relativePath, "path");
  if (isSensitiveRelativePath(relative)) fail("sensitive files are not available to workspace tools.");
  const candidate = path.resolve(root, relative);
  if (!isContainedPath(path.resolve(root), candidate)) fail("path is outside the workspace.");
  const resolved = await resolveRealPathWithinRoot(root, candidate);
  if (!resolved) fail("path is outside the workspace.");
  const canonicalRoot = await fs.realpath(root);
  if (isSensitiveRelativePath(toWorkspacePath(canonicalRoot, resolved))) {
    fail("sensitive files are not available to workspace tools.");
  }
  const stat = await fs.stat(resolved);
  if (kind === "file" && !stat.isFile()) fail("path is not a file.");
  if (kind === "directory" && !stat.isDirectory()) fail("path is not a directory.");
  return { relative, resolved, stat };
}

function toWorkspacePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/") || ".";
}

function boundedUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return { value, truncated: false };
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return { value: bytes.subarray(0, end).toString("utf8"), truncated: true };
}


async function readBoundedUtf8(filePath: string): Promise<{ value: string; truncated: boolean }> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(MAX_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    return boundedUtf8(buffer.subarray(0, bytesRead).toString("utf8"), MAX_FILE_BYTES);
  } finally {
    await handle.close();
  }
}
export function makeWorkspaceTools(workspaceRoot: string): ReadonlyArray<AiSdkToolDefinition> {
  const root = path.resolve(workspaceRoot.trim());
  if (!workspaceRoot.trim()) return [];

  const listDirectory: AiSdkToolDefinition = {
    name: "list_directory",
    description: "List files and directories inside the selected workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative directory path." } },
    },
    execute: async (args) => {
      const target = await resolveExisting(root, String(args.path ?? ""), "directory");
      const entries = (await fs.readdir(target.resolved, { withFileTypes: true }))
        .filter((entry) => entry.name !== ".git" && !isSensitiveRelativePath(`${target.relative}/${entry.name}`))
        .toSorted((a, b) => a.name.localeCompare(b.name));
      const visible = entries.slice(0, MAX_DIRECTORY_ENTRIES).map((entry) => ({
        path: `${target.relative ? `${target.relative}/` : ""}${entry.name}`,
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      }));
      return { path: target.relative || ".", entries: visible, truncated: entries.length > visible.length };
    },
  };

  const readFile: AiSdkToolDefinition = {
    name: "read_file",
    description: "Read a UTF-8 text file inside the selected workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative file path." } },
      required: ["path"],
    },
    execute: async (args) => {
      const target = await resolveExisting(root, String(args.path ?? ""), "file");
      const bounded = await readBoundedUtf8(target.resolved);
      return { path: target.relative, content: bounded.value, truncated: bounded.truncated };
    },
  };

  const searchFiles: AiSdkToolDefinition = {
    name: "search_files",
    description: "Search UTF-8 text files inside the selected workspace for a literal query.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal text to find." },
        path: { type: "string", description: "Optional workspace-relative directory." },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) fail("query must be a non-empty string.");
      const start = await resolveExisting(root, String(args.path ?? ""), "directory");
      const canonicalRoot = await fs.realpath(root);
      const results: Array<{ path: string; line: number; text: string }> = [];
      let truncated = false;
      let scannedFiles = 0;
      const visitedDirectories = new Set<string>();
      const visit = async (directory: string, depth: number): Promise<void> => {
        if (visitedDirectories.has(directory)) return;
        visitedDirectories.add(directory);
        if (depth > MAX_SEARCH_DEPTH || results.length >= MAX_SEARCH_RESULTS) {
          truncated = true;
          return;
        }
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= MAX_SEARCH_RESULTS) {
            truncated = true;
            return;
          }
          if (entry.isDirectory()) {
            if (IGNORED_DIRECTORIES.has(entry.name)) continue;
            const child = path.join(directory, entry.name);
            const safe = await resolveRealPathWithinRoot(root, child);
            if (safe && !isSensitiveRelativePath(toWorkspacePath(canonicalRoot, safe))) await visit(safe, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;
          scannedFiles += 1;
          if (scannedFiles > MAX_SEARCH_FILES) {
            truncated = true;
            return;
          }
          const filePath = path.join(directory, entry.name);
          const safe = await resolveRealPathWithinRoot(root, filePath);
          if (!safe || isSensitiveRelativePath(toWorkspacePath(canonicalRoot, safe))) continue;
          const stat = await fs.stat(safe);
          if (stat.size > MAX_SEARCH_FILE_BYTES) continue;
          const content = await fs.readFile(safe, "utf8");
          const lines = content.split(/\r?\n/u);
          for (let index = 0; index < lines.length; index += 1) {
            if (!lines[index]!.includes(query)) continue;
            results.push({ path: toWorkspacePath(canonicalRoot, safe), line: index + 1, text: boundedUtf8(lines[index]!, 2_000).value });
            if (results.length >= MAX_SEARCH_RESULTS) {
              truncated = true;
              return;
            }
          }
        }
      };
      await visit(start.resolved, 0);
      return { query, results, truncated };
    },
  };

  return [listDirectory, readFile, searchFiles];
}
