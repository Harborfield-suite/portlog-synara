import "../index.css";

import { SpaceId } from "@synara/contracts";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { PortLogWorkspaceLauncher } from "./PortLogWorkspaceLauncher";
import type { Project } from "../types";
import type { PortLogWorkspaceSource } from "../portlog/portlogWorkspaceSource";

const project: Project = {
  id: "project-1" as Project["id"],
  kind: "project",
  name: "North Field Plant",
  remoteName: "North Field Plant",
  folderName: "north-field",
  localName: null,
  cwd: "/Projects/north-field",
  defaultModelSelection: null,
  expanded: true,
  spaceId: null,
  scripts: [],
};

describe("PortLogWorkspaceLauncher runtime path", () => {
  it("opens a recent workspace through PortLog without the Synara callback", async () => {
    const source: PortLogWorkspaceSource = {
      open: vi.fn(async (root: string) => ({
        projectId: "portlog-project-1",
        root,
      })),
      list: vi.fn(),
      readFile: vi.fn(),
    };
    const onOpenPortLogWorkspace = vi.fn();
    const onOpenProject = vi.fn();

    await render(
      <PortLogWorkspaceLauncher
        projects={[project]}
        spaces={[]}
        activeSpaceId={SpaceId.makeUnsafe("space-1")}
        homeDir="/Users/tester"
        onOpenProject={onOpenProject}
        workspaceSource={source}
        onOpenPortLogWorkspace={onOpenPortLogWorkspace}
      />,
    );

    await page.getByRole("button", { name: /North Field Plant/ }).click();
    await vi.waitFor(() => expect(onOpenPortLogWorkspace).toHaveBeenCalledOnce());

    expect(source.open).toHaveBeenCalledWith("/Projects/north-field");
    expect(onOpenProject).not.toHaveBeenCalled();
    expect(onOpenPortLogWorkspace).toHaveBeenCalledWith(
      { projectId: "portlog-project-1", root: "/Projects/north-field" },
      "North Field Plant",
    );
  });
});
