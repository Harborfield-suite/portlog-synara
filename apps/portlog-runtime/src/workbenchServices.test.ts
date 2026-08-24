import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  describeArtifact,
  ensureProjectRoot,
  listRegisteredArtifacts,
  listWorkspaceEntries,
  readContent,
  workspaceLocator,
  writeContent,
} from "./workbenchServices";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => FS.rm(directory, { recursive: true, force: true })),
  );
});

async function makeProject(): Promise<{ root: string; project: { projectId: string; root: string } }> {
  const root = await FS.mkdtemp(Path.join(OS.tmpdir(), "portlog-workbench-test-"));
  temporaryDirectories.push(root);
  return { root, project: { projectId: "project-1", root } };
}

describe("PortLog workbench services", () => {
  it("lists workspace entries without exposing Synara internals", async () => {
    const { root, project } = await makeProject();
    await FS.mkdir(Path.join(root, ".synara"));
    await FS.writeFile(Path.join(root, ".synara", "secret.txt"), "secret");
    await FS.mkdir(Path.join(root, "input"));
    await FS.writeFile(Path.join(root, "input", "plant.svg"), "<svg />");

    const entries = await listWorkspaceEntries(project, "input");

    expect(entries).toEqual([
      expect.objectContaining({
        locator: workspaceLocator("project-1", "input/plant.svg"),
        relativePath: "input/plant.svg",
        kind: "file",
      }),
    ]);
  });

  it("reads content through a workspace locator and reports truncation", async () => {
    const { root, project } = await makeProject();
    await FS.writeFile(Path.join(root, "facts.json"), "1234567890");
    const locator = workspaceLocator("project-1", "facts.json");

    const result = await readContent(new Map([[project.projectId, project]]), {
      locator,
      maxBytes: 4,
    });

    expect(result.contents).toBe("1234");
    expect(result.totalBytes).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it("writes workspace content and rejects stale versions", async () => {
    const { root, project } = await makeProject();
    await FS.writeFile(Path.join(root, "notes.md"), "before");
    const projects = new Map([[project.projectId, project]]);

    const saved = await writeContent(projects, {
      projectId: project.projectId,
      relativePath: "notes.md",
      contents: "after",
    });

    expect(saved.version).toMatch(/^sha256:[a-f0-9]{64}$/u);
    await expect(
      writeContent(projects, {
        projectId: project.projectId,
        relativePath: "notes.md",
        contents: "stale",
        expectedVersion: "sha256:stale",
      }),
    ).rejects.toMatchObject({ code: "FILE_VERSION_CONFLICT" });
    expect(await FS.readFile(Path.join(root, "notes.md"), "utf8")).toBe("after");
  });

  it("only exposes registered artifacts and describes their digest", async () => {
    const { root, project } = await makeProject();
    await FS.writeFile(Path.join(root, "answer.json"), "{}");
    await FS.writeFile(
      Path.join(root, "portlog-project.json"),
      JSON.stringify({ artifacts: [{ id: "answer", path: "answer.json", kind: "answer" }] }),
    );

    const artifacts = await listRegisteredArtifacts(project);
    const described = await describeArtifact(project, "answer");

    expect(artifacts).toHaveLength(1);
    expect(described.artifactId).toBe("answer");
    expect(described.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("creates a missing project directory only when requested", async () => {
    const root = Path.join(await FS.mkdtemp(Path.join(OS.tmpdir(), "portlog-workbench-test-")), "new-project");
    temporaryDirectories.push(Path.dirname(root));

    await expect(ensureProjectRoot(root)).rejects.toThrow();
    const canonicalRoot = await ensureProjectRoot(root, true);
    expect(canonicalRoot).toBe(await FS.realpath(root));
  });
});
