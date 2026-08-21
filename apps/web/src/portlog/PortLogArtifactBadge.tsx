// FILE: PortLogArtifactBadge.tsx
// Purpose: Compact explorer badge for PortLog-classified workspace files.
// Layer: Web craft presentation

import { classifyPortLogWorkspaceArtifact } from "./portlogWorkspaceArtifacts";

export function PortLogArtifactBadge(props: { pathValue: string }) {
  const artifact = classifyPortLogWorkspaceArtifact(props.pathValue);
  if (!artifact.badge) {
    return null;
  }
  return (
    <span
      data-portlog-artifact={artifact.kind}
      data-testid="portlog-artifact-badge"
      className="ml-auto shrink-0 rounded px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80 ring-1 ring-border/70"
      title={`PortLog ${artifact.kind}`}
    >
      {artifact.badge}
    </span>
  );
}
