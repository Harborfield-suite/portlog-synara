import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeWorkspaceTools } from "./workspaceTools.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("makeWorkspaceTools", () => {
  it("lists, reads, and searches only inside the selected workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synara-workspace-tools-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "example.ts"), "const needle = true;\n", "utf8");

    const tools = Object.fromEntries(makeWorkspaceTools(root).map((tool) => [tool.name, tool]));
    await expect(tools.list_directory!.execute!({ path: "src" })).resolves.toMatchObject({
      entries: [{ path: "src/example.ts", kind: "file" }],
    });
    await expect(tools.read_file!.execute!({ path: "src/example.ts" })).resolves.toMatchObject({
      path: "src/example.ts",
      content: "const needle = true;\n",
      truncated: false,
    });
    await expect(tools.search_files!.execute!({ query: "needle" })).resolves.toMatchObject({
      results: [{ path: "src/example.ts", line: 1 }],
    });
  });

  it("rejects traversal and symlink escapes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synara-workspace-tools-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "synara-workspace-outside-"));
    temporaryRoots.push(root, outside);
    await writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    await writeFile(path.join(root, ".env"), "TOKEN=secret", "utf8");
    await mkdir(path.join(root, ".aws"));
    await writeFile(path.join(root, ".aws", "credentials"), "AWS_SECRET=secret", "utf8");
    await writeFile(path.join(root, "id_rsa"), "PRIVATE KEY", "utf8");
    await symlink(path.join(root, ".env"), path.join(root, "notes.txt"));
    await symlink(outside, path.join(root, "outside"));

    const tools = Object.fromEntries(makeWorkspaceTools(root).map((tool) => [tool.name, tool]));
    await expect(tools.read_file!.execute!({ path: "../secret.txt" })).rejects.toThrow(
      "outside the workspace",
    );
    await expect(tools.read_file!.execute!({ path: "outside/secret.txt" })).rejects.toThrow(
      "outside the workspace",
    );
    await expect(tools.read_file!.execute!({ path: ".env" })).rejects.toThrow("sensitive files");
    await expect(tools.read_file!.execute!({ path: ".aws/credentials" })).rejects.toThrow("sensitive files");
    await expect(tools.read_file!.execute!({ path: "id_rsa" })).rejects.toThrow("sensitive files");
    await expect(tools.read_file!.execute!({ path: "notes.txt" })).rejects.toThrow("sensitive files");
    await expect(tools.list_directory!.execute!({ path: "" })).resolves.toMatchObject({
      entries: expect.not.arrayContaining([
        expect.objectContaining({ path: ".aws" }),
        expect.objectContaining({ path: "id_rsa" }),
      ]),
    });
    await expect(readFile(path.join(outside, "secret.txt"), "utf8")).resolves.toBe("secret");
  });

  it("bounds file, directory, and search results and avoids duplicate aliases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synara-workspace-tools-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "large.txt"), "é".repeat(50_000), "utf8");
    await Promise.all(
      Array.from({ length: 205 }, (_, index) => writeFile(path.join(root, "entry-" + index + ".txt"), "x", "utf8")),
    );
    await Promise.all(
      Array.from({ length: 101 }, (_, index) => writeFile(path.join(root, "src", "match-" + index + ".txt"), "needle", "utf8")),
    );
    await symlink(path.join(root, "src"), path.join(root, "alias"));

    const tools = Object.fromEntries(makeWorkspaceTools(root).map((tool) => [tool.name, tool]));
    const large = await tools.read_file!.execute!({ path: "src/large.txt" });
    expect(Buffer.byteLength(String(large.content), "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(large.truncated).toBe(true);
    await expect(tools.list_directory!.execute!({ path: "" })).resolves.toMatchObject({
      truncated: true,
      entries: expect.any(Array),
    });
    const search = await tools.search_files!.execute!({ query: "needle" });
    expect(search.results).toHaveLength(100);
    expect(search.truncated).toBe(true);
    expect(search.results.filter((result: { path: string }) => result.path.startsWith("src/")).length).toBe(100);
  });

});
