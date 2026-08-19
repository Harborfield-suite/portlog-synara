import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEXPI_RENDERER_PROTOCOL_VERSION,
  readDexpiArtifactManifest,
  renderDexpiSource,
  resolveDexpiArtifactPaths,
} from "./dexpi-renderer.mjs";

describe("local DEXPI renderer contract", () => {
  it("uses stable artifact names and protocol version", () => {
    expect(resolveDexpiArtifactPaths("/tmp/portlog-artifact")).toEqual({
      manifestPath: "/tmp/portlog-artifact/manifest.json",
      svgPath: "/tmp/portlog-artifact/rendered.svg",
      scenePath: "/tmp/portlog-artifact/scene.json",
      diagnosticsPath: "/tmp/portlog-artifact/diagnostics.json",
    });
    expect(DEXPI_RENDERER_PROTOCOL_VERSION).toBe(1);
  });

  it("reuses a complete artifact for the same source hash", async () => {
    const root = await mkdtemp(join(tmpdir(), "portlog-dexpi-test-"));
    const sourcePath = join(root, "drawing.xml");
    const cacheRoot = join(root, "cache");
    const sourceContents = "<Drawing />";
    await writeFile(sourcePath, sourceContents);
    const sourceSha256 = createHash("sha256").update(sourceContents).digest("hex");
    const outputDir = join(cacheRoot, sourceSha256);
    await mkdir(outputDir, { recursive: true });
    const paths = resolveDexpiArtifactPaths(outputDir);
    await Promise.all([
      writeFile(paths.svgPath, '<svg><use data-id="P-101" /></svg>'),
      writeFile(paths.scenePath, JSON.stringify({ symbols: [{ id: "P-101" }], polylines: [] })),
      writeFile(paths.diagnosticsPath, JSON.stringify({ report: {} })),
      writeFile(
        paths.manifestPath,
        JSON.stringify({
          protocolVersion: DEXPI_RENDERER_PROTOCOL_VERSION,
          sourceSha256,
          artifacts: {
            svg: "rendered.svg",
            scene: "scene.json",
            diagnostics: "diagnostics.json",
          },
        }),
      ),
    ]);

    expect(await readDexpiArtifactManifest(paths.manifestPath)).toEqual({
      protocolVersion: 1,
      sourceSha256,
      artifacts: {
        svg: "rendered.svg",
        scene: "scene.json",
        diagnostics: "diagnostics.json",
      },
    });

    const result = await renderDexpiSource({
      sourcePath,
      cacheRoot,
      rendererPath: join(root, "spike.py"),
      execFile: async () => {
        throw new Error("the renderer must not run for a cache hit");
      },
    });

    expect(result.cached).toBe(true);
    expect(result.svgPath).toBe(paths.svgPath);
    expect(result.scenePath).toBe(paths.scenePath);
  });
});
