// FILE: portlogWorkspaceArtifacts.ts
// Purpose: Classify workspace paths as PortLog DEXPI / project / prepared artifacts.
// Layer: Web craft presentation helpers

export const PORTLOG_PROJECT_MANIFEST_NAME = "portlog-project.json";

export type PortLogWorkspaceArtifactKind =
  | "dexpi-source"
  | "project-manifest"
  | "prepared"
  | "ordinary";

export type PortLogWorkspaceArtifact = {
  kind: PortLogWorkspaceArtifactKind;
  /** Short explorer badge; null for ordinary files. */
  badge: string | null;
};

const PREPARED_NAME_RE = /(?:^|\/)(?:artifacts?|prepared|topology|facts|scene)(?:\/|$)/i;
const PREPARED_FILE_RE = /\.(?:facts\.json|topology\.json|scene\.json|pid\.json)$/i;

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function basename(pathValue: string): string {
  const normalized = normalizePath(pathValue);
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

/** Classify a workspace-relative or absolute path for PortLog explorer chrome. */
export function classifyPortLogWorkspaceArtifact(pathValue: string): PortLogWorkspaceArtifact {
  const normalized = normalizePath(pathValue.trim());
  if (!normalized) {
    return { kind: "ordinary", badge: null };
  }
  const name = basename(normalized);
  if (name.toLowerCase() === PORTLOG_PROJECT_MANIFEST_NAME) {
    return { kind: "project-manifest", badge: "PortLog" };
  }
  if (PREPARED_FILE_RE.test(name) || PREPARED_NAME_RE.test(normalized)) {
    return { kind: "prepared", badge: "artifact" };
  }
  if (/\.xml$/i.test(name)) {
    return { kind: "dexpi-source", badge: "DEXPI" };
  }
  return { kind: "ordinary", badge: null };
}

export function isPortLogPrimaryDrawingPath(pathValue: string): boolean {
  return classifyPortLogWorkspaceArtifact(pathValue).kind === "dexpi-source";
}

export function resolvePortLogEditorCenterMode(pathValue: string): "file" | "drawing" {
  return isPortLogPrimaryDrawingPath(pathValue) ? "drawing" : "file";
}

/** Stable sort key: DEXPI and PortLog project files rise above ordinary noise. */
export function portLogArtifactSortRank(pathValue: string): number {
  switch (classifyPortLogWorkspaceArtifact(pathValue).kind) {
    case "dexpi-source":
      return 0;
    case "project-manifest":
      return 1;
    case "prepared":
      return 2;
    default:
      return 3;
  }
}
