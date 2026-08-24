import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { PORTLOG_TOOL_POLICY, sanitizeBashEnvironment } from "./toolPolicy";

const temporaryDirectories: string[] = [];

function text(result: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
  return result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    FS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("PortLog Pi tool policy", () => {
  it("exercises read, write, edit, and bash against one workspace", async () => {
    const cwd = FS.mkdtempSync(Path.join(OS.tmpdir(), "portlog-tool-conformance-"));
    temporaryDirectories.push(cwd);
    const write = createWriteTool(cwd);
    const read = createReadTool(cwd);
    const edit = createEditTool(cwd);
    const bash = createBashTool(cwd, { spawnHook: sanitizeBashEnvironment });

    await write.execute("write-1", { path: "fixture.txt", content: "before" });
    expect(text(await read.execute("read-1", { path: "fixture.txt" }))).toContain("before");
    await edit.execute("edit-1", {
      path: "fixture.txt",
      edits: [{ oldText: "before", newText: "after" }],
    });
    expect(FS.readFileSync(Path.join(cwd, "fixture.txt"), "utf8")).toBe("after");
    await bash.execute("bash-1", { command: "printf bash-ok > bash.txt" });
    expect(FS.readFileSync(Path.join(cwd, "bash.txt"), "utf8")).toBe("bash-ok");
    expect(PORTLOG_TOOL_POLICY).toEqual(["read", "write", "edit", "bash"]);
  });

  it("removes credentials before bash receives the environment", () => {
    const sanitized = sanitizeBashEnvironment({
      command: "printf ok",
      cwd: "/tmp",
      env: {
        PATH: "/bin",
        PORTLOG_OPENROUTER_API_KEY: "secret",
        OPENROUTER_API_KEY: "secret",
        PORTLOG_OPENAI_API_KEY: "secret",
        OPENAI_API_KEY: "secret",
      },
    });

    expect(sanitized.env).toEqual({ PATH: "/bin" });
  });
});
