import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";

import type {
  PortLogRuntimeArtifact,
  PortLogRuntimeArtifactDescription,
  PortLogRuntimeContentReadInput,
  PortLogRuntimeContentReadResult,
  PortLogRuntimeContentWriteInput,
  PortLogRuntimeContentWriteResult,
  PortLogRuntimeProject,
  PortLogRuntimeProjectDescription,
  PortLogRuntimeWorkspaceEntry,
} from "@synara/contracts";

const PROJECT_MANIFEST = "portlog-project.json";
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_DIRECTORY_ENTRIES = 2_000;
const MAX_CONTENT_BYTES = 1_000_000;

type ProjectManifestArtifact = {
  readonly id?: unknown;
  readonly path?: unknown;
  readonly kind?: unknown;
  readonly description?: unknown;
};

type ProjectManifest = {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly artifacts?: unknown;
};

export class WorkbenchServiceError extends Error {
  readonly code:
    | "INVALID_LOCATOR"
    | "PATH_OUTSIDE_PROJECT"
    | "ARTIFACT_NOT_FOUND"
    | "CONTENT_TOO_LARGE"
    | "FILE_VERSION_CONFLICT";

  constructor(
    code: WorkbenchServiceError["code"],
    message: string,
  ) {
    super(message);
    this.name = "WorkbenchServiceError";
    this.code = code;
  }
}

export async function ensureProjectRoot(root: string, createIfMissing = false): Promise<string> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await FS.promises.realpath(root);
  } catch (cause: unknown) {
    if (!createIfMissing || !isNodeError(cause, "ENOENT")) {
      throw cause;
    }
    await FS.promises.mkdir(root, { recursive: true });
    canonicalRoot = await FS.promises.realpath(root);
  }
  const stat = await FS.promises.stat(canonicalRoot);
  if (!stat.isDirectory()) throw new Error("project.open requires a directory.");
  return canonicalRoot;
}

export async function describeProject(
  project: PortLogRuntimeProject,
): Promise<PortLogRuntimeProjectDescription> {
  const manifest = await readManifest(project.root);
  const name = stringValue(manifest?.name) ?? Path.basename(project.root);
  const description = stringValue(manifest?.description);
  return {
    ...project,
    name,
    ...(description ? { description } : {}),
    ...(await FS.promises.stat(Path.join(project.root, PROJECT_MANIFEST)).catch(() => null)
      ? { manifestLocator: workspaceLocator(project.projectId, PROJECT_MANIFEST) }
      : {}),
  };
}

export async function listWorkspaceEntries(
  project: PortLogRuntimeProject,
  relativePath = "",
  includeFiles = true,
): Promise<ReadonlyArray<PortLogRuntimeWorkspaceEntry>> {
  const directory = await resolveExistingPath(project.root, relativePath, true);
  const entries = await FS.promises.readdir(directory, { withFileTypes: true });
  const visible = entries
    .filter((entry) => !entry.name.startsWith(".synara"))
    .filter((entry) => includeFiles || entry.isDirectory())
    .slice(0, MAX_DIRECTORY_ENTRIES)
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  const resolvedEntries = await Promise.all(
    visible.map(async (entry) => {
      const entryPath = relativePath ? Path.join(relativePath, entry.name) : entry.name;
      const resolved = await resolveExistingPath(project.root, entryPath, entry.isDirectory()).catch(() => null);
      if (!resolved) return null;
      const stat = await FS.promises.stat(resolved);
      return {
        locator: workspaceLocator(project.projectId, entryPath),
        relativePath: normalizeRelativePath(entryPath),
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
        ...(entry.isDirectory() ? {} : { sizeBytes: stat.size }),
      } satisfies PortLogRuntimeWorkspaceEntry;
    }),
  );
  return resolvedEntries.filter(
    (entry): entry is PortLogRuntimeWorkspaceEntry => entry !== null,
  );
}

export async function listRegisteredArtifacts(
  project: PortLogRuntimeProject,
): Promise<ReadonlyArray<PortLogRuntimeArtifact>> {
  const manifest = await readManifest(project.root);
  const registrations = manifest?.artifacts;
  if (!Array.isArray(registrations)) return [];
  const artifacts: PortLogRuntimeArtifact[] = [];
  for (const raw of registrations) {
    const registration = readArtifactRegistration(raw);
    if (!registration) continue;
    const file = await resolveExistingPath(project.root, registration.path, false).catch(() => null);
    if (!file) continue;
    const stat = await FS.promises.stat(file);
    artifacts.push({
      artifactId: registration.id,
      projectId: project.projectId,
      kind: registration.kind,
      locator: artifactLocator(project.projectId, registration.id),
      relativePath: registration.path,
      name: Path.basename(registration.path),
      ...(registration.description ? { description: registration.description } : {}),
      sizeBytes: stat.size,
    });
  }
  return artifacts;
}

async function findRegisteredArtifact(
  project: PortLogRuntimeProject,
  artifactId: string,
): Promise<PortLogRuntimeArtifact> {
  const artifact = (await listRegisteredArtifacts(project)).find(
    (candidate) => candidate.artifactId === artifactId,
  );
  if (!artifact) throw new WorkbenchServiceError("ARTIFACT_NOT_FOUND", `Artifact '${artifactId}' was not found.`);
  return artifact;
}

export async function describeArtifact(
  project: PortLogRuntimeProject,
  artifactId: string,
): Promise<PortLogRuntimeArtifactDescription> {
  const artifact = await findRegisteredArtifact(project, artifactId);
  const file = await resolveExistingPath(project.root, artifact.relativePath, false);
  const hash = Crypto.createHash("sha256");
  for await (const chunk of FS.createReadStream(file)) hash.update(chunk);
  return { ...artifact, sha256: hash.digest("hex") };
}

function contentVersion(contents: Uint8Array): string {
  return `sha256:${Crypto.createHash("sha256").update(contents).digest("hex")}`;
}

export async function writeContent(
  projects: ReadonlyMap<string, PortLogRuntimeProject>,
  input: PortLogRuntimeContentWriteInput,
): Promise<PortLogRuntimeContentWriteResult> {
  const project = projects.get(input.projectId);
  if (!project) throw new WorkbenchServiceError("INVALID_LOCATOR", "The project was not found.");
  if (!isSafeRelativePath(input.relativePath)) {
    throw new WorkbenchServiceError("PATH_OUTSIDE_PROJECT", "The requested path is outside the project.");
  }
  const file = await resolveExistingPath(project.root, input.relativePath, false);
  const current = await FS.promises.readFile(file);
  const currentVersion = contentVersion(current);
  if (input.expectedVersion && input.expectedVersion !== currentVersion) {
    throw new WorkbenchServiceError("FILE_VERSION_CONFLICT", "The workspace file changed before it was saved.");
  }
  const contents = Buffer.from(input.contents, "utf8");
  await FS.promises.writeFile(file, contents);
  return {
    projectId: project.projectId,
    relativePath: normalizeRelativePath(input.relativePath),
    version: contentVersion(contents),
  };
}

export async function readContent(
  projects: ReadonlyMap<string, PortLogRuntimeProject>,
  input: PortLogRuntimeContentReadInput,
): Promise<PortLogRuntimeContentReadResult> {
  const locator = parseLocator(input.locator);
  const project = projects.get(locator.projectId);
  if (!project) throw new WorkbenchServiceError("INVALID_LOCATOR", "The locator references an unknown project.");
  const relativePath = locator.kind === "workspace"
    ? locator.relativePath
    : (await findRegisteredArtifact(project, locator.artifactId)).relativePath;
  const file = await resolveExistingPath(project.root, relativePath, false);
  const maxBytes = Math.min(Math.max(1, input.maxBytes ?? MAX_CONTENT_BYTES), MAX_CONTENT_BYTES);
  const offset = Math.max(0, input.offset ?? 0);
  const stat = await FS.promises.stat(file);
  const length = Math.max(0, Math.min(maxBytes, stat.size - offset));
  const buffer = Buffer.alloc(length);
  if (length > 0) {
    const handle = await FS.promises.open(file, "r");
    try {
      await handle.read(buffer, 0, length, offset);
    } finally {
      await handle.close();
    }
  }
  return {
    locator: input.locator,
    relativePath,
    contents: buffer.toString("utf8"),
    offset,
    totalBytes: stat.size,
    truncated: offset + length < stat.size,
    ...(offset === 0 && offset + length >= stat.size ? { version: contentVersion(buffer) } : {}),
  };
}

async function readManifest(root: string): Promise<ProjectManifest | null> {
  try {
    const contents = await FS.promises.readFile(Path.join(root, PROJECT_MANIFEST));
    if (contents.byteLength > MAX_MANIFEST_BYTES) return null;
    const parsed: unknown = JSON.parse(contents.toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ProjectManifest)
      : null;
  } catch {
    return null;
  }
}

function readArtifactRegistration(value: unknown): {
  id: string;
  path: string;
  kind: string;
  description?: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const artifact = value as ProjectManifestArtifact;
  const id = stringValue(artifact.id);
  const path = stringValue(artifact.path);
  if (!id || !path || !isSafeRelativePath(path)) return null;
  const kind = stringValue(artifact.kind) ?? "derived";
  const description = stringValue(artifact.description);
  return { id, path: normalizeRelativePath(path), kind, ...(description ? { description } : {}) };
}

async function resolveExistingPath(root: string, relativePath: string, directory: boolean): Promise<string> {
  if (!isSafeRelativePath(relativePath)) {
    throw new WorkbenchServiceError("PATH_OUTSIDE_PROJECT", "The requested path is outside the project.");
  }
  const candidate = Path.resolve(root, relativePath || ".");
  const realRoot = await FS.promises.realpath(root);
  const realPath = await FS.promises.realpath(candidate);
  if (!isContained(realRoot, realPath)) {
    throw new WorkbenchServiceError("PATH_OUTSIDE_PROJECT", "The requested path is outside the project.");
  }
  const stat = await FS.promises.stat(realPath);
  if (directory && !stat.isDirectory()) throw new Error("The requested workspace path is not a directory.");
  if (!directory && !stat.isFile()) throw new Error("The requested artifact path is not a file.");
  return realPath;
}

function isSafeRelativePath(value: string): boolean {
  return value.length === 0 || (!Path.isAbsolute(value) && !value.includes("\0") && !value.split(/[\\/]/u).includes(".."));
}

function isContained(root: string, candidate: string): boolean {
  const relative = Path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${Path.sep}`) && relative !== ".." && !Path.isAbsolute(relative));
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll(Path.sep, "/").replaceAll("\\", "/");
}

function isNodeError(cause: unknown, code: string): cause is NodeJS.ErrnoException {
  return cause instanceof Error && "code" in cause && cause.code === code;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function workspaceLocator(projectId: string, relativePath: string): string {
  return `workspace:${projectId}:${encode(normalizeRelativePath(relativePath))}`;
}

export function artifactLocator(projectId: string, artifactId: string): string {
  return `artifact:${projectId}:${encode(artifactId)}`;
}

function parseLocator(locator: string):
  | { kind: "workspace"; projectId: string; relativePath: string }
  | { kind: "artifact"; projectId: string; artifactId: string } {
  const parts = locator.split(":");
  if (parts.length !== 3 || !parts[1] || !parts[2]) {
    throw new WorkbenchServiceError("INVALID_LOCATOR", "The content locator is invalid.");
  }
  const value = decode(parts[2]);
  if (parts[0] === "workspace" && isSafeRelativePath(value)) {
    return { kind: "workspace", projectId: parts[1], relativePath: normalizeRelativePath(value) };
  }
  if (parts[0] === "artifact" && value.length > 0) {
    return { kind: "artifact", projectId: parts[1], artifactId: value };
  }
  throw new WorkbenchServiceError("INVALID_LOCATOR", "The content locator is invalid.");
}
