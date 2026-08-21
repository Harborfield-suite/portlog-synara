import { ProjectId, SpaceId } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PortLogWorkspaceLauncher } from "./PortLogWorkspaceLauncher";
import type { Project } from "../types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    kind: "project",
    name: "North Field Plant",
    remoteName: "North Field Plant",
    folderName: "north-field",
    localName: null,
    cwd: "/Projects/north-field",
    defaultModelSelection: null,
    expanded: true,
    spaceId: null,
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    scripts: [],
    ...overrides,
  };
}

describe("PortLogWorkspaceLauncher", () => {
  it("renders recent workspaces and first-class project actions", () => {
    const markup = renderToStaticMarkup(
      <PortLogWorkspaceLauncher
        projects={[makeProject()]}
        spaces={[]}
        activeSpaceId={SpaceId.makeUnsafe("space-1")}
        homeDir="/Users/tester"
        onOpenProject={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="portlog-workspace-launcher"');
    expect(markup).toContain("North Field Plant");
    expect(markup).toContain("Open folder");
    expect(markup).toContain("New project");
    expect(markup).toContain("Drop documents");
  });
});
