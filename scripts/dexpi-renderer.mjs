#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const DEXPI_RENDERER_PROTOCOL_VERSION = 1;

const execFilePromise = promisify(nodeExecFile);
const PYDEXPI_RENDERER_PROGRAM = String.raw`
import importlib.util
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

renderer_path = Path(sys.argv[1]).resolve()
source_path = Path(sys.argv[2]).resolve()
output_dir = Path(sys.argv[3]).resolve()
spec = importlib.util.spec_from_file_location("portlog_pydexpi_renderer", renderer_path)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load renderer module: {renderer_path}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = ET.parse(source_path).getroot()
name = source_path.stem
scene, catalogue = module.build_scene(root, name)
svg, extent = module.scene_to_svg(scene, catalogue)
output_dir.mkdir(parents=True, exist_ok=True)
(output_dir / "rendered.svg").write_text(svg, encoding="utf-8")
(output_dir / "scene.json").write_text(
    json.dumps(scene, indent=2, default=list), encoding="utf-8"
)
(output_dir / "diagnostics.json").write_text(
    json.dumps(
        {
            "renderer": str(renderer_path),
            "source": str(source_path),
            "extent": list(extent),
            "report": scene.get("report", {}),
            "symbolCount": len(scene.get("symbols", [])),
            "polylineCount": len(scene.get("polylines", [])),
            "textCount": len(scene.get("texts", [])),
        },
        indent=2,
    ),
    encoding="utf-8",
)
`;

export function resolveDexpiArtifactPaths(outputDir) {
  const directory = resolve(outputDir);
  return {
    manifestPath: join(directory, "manifest.json"),
    svgPath: join(directory, "rendered.svg"),
    scenePath: join(directory, "scene.json"),
    diagnosticsPath: join(directory, "diagnostics.json"),
  };
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isArtifactManifest(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.protocolVersion === DEXPI_RENDERER_PROTOCOL_VERSION &&
    isSha256(value.sourceSha256) &&
    value.artifacts !== null &&
    typeof value.artifacts === "object" &&
    value.artifacts.svg === "rendered.svg" &&
    value.artifacts.scene === "scene.json" &&
    value.artifacts.diagnostics === "diagnostics.json"
  );
}

export async function readDexpiArtifactManifest(manifestPath) {
  try {
    const value = JSON.parse(await readFile(manifestPath, "utf8"));
    return isArtifactManifest(value) ? value : null;
  } catch {
    return null;
  }
}

async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function isCompleteArtifact(paths) {
  try {
    const entries = await Promise.all([
      stat(paths.svgPath),
      stat(paths.scenePath),
      stat(paths.diagnosticsPath),
    ]);
    return entries.every((entry) => entry.isFile());
  } catch {
    return false;
  }
}

async function validateArtifactContents(paths) {
  const [svg, sceneRaw, diagnosticsRaw] = await Promise.all([
    readFile(paths.svgPath, "utf8"),
    readFile(paths.scenePath, "utf8"),
    readFile(paths.diagnosticsPath, "utf8"),
  ]);
  if (!/<svg(?:\s|>)/u.test(svg)) {
    throw new Error("The pydexpi renderer produced an invalid SVG artifact.");
  }
  const scene = JSON.parse(sceneRaw);
  if (
    scene === null ||
    typeof scene !== "object" ||
    !Array.isArray(scene.symbols) ||
    !Array.isArray(scene.polylines)
  ) {
    throw new Error("The pydexpi renderer produced an invalid scene artifact.");
  }
  if (
    scene.symbols.length > 0 &&
    (!scene.symbols.some((symbol) => typeof symbol?.id === "string" && symbol.id.length > 0) ||
      !/data-id=/u.test(svg))
  ) {
    throw new Error("The pydexpi renderer produced selectable symbols without stable IDs.");
  }
  const diagnostics = JSON.parse(diagnosticsRaw);
  if (diagnostics === null || typeof diagnostics !== "object") {
    throw new Error("The pydexpi renderer produced invalid diagnostics.");
  }
}

// ponytail: imports are serialized by the caller; add a per-artifact lock before parallel imports.
async function invokeRenderer(execFile, pythonPath, rendererPath, sourcePath, outputDir) {
  return execFile(
    pythonPath,
    ["-c", PYDEXPI_RENDERER_PROGRAM, rendererPath, sourcePath, outputDir],
    {
      cwd: dirname(rendererPath),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

export async function renderDexpiSource(input) {
  const sourcePath = resolve(input.sourcePath);
  const outputDir = resolve(input.outputDir);
  const rendererPath = input.rendererPath ? resolve(input.rendererPath) : null;
  const paths = resolveDexpiArtifactPaths(outputDir);
  const sourceSha256 = await sha256File(sourcePath);
  const cachedManifest = await readDexpiArtifactManifest(paths.manifestPath);

  if (cachedManifest?.sourceSha256 === sourceSha256 && (await isCompleteArtifact(paths))) {
    try {
      await validateArtifactContents(paths);
      return { ...paths, sourceSha256, cached: true };
    } catch {
      // A partial or corrupt cache is cheaper to replace than to expose to the UI.
    }
  }

  if (!rendererPath) {
    throw new Error(
      "No pydexpi renderer configured. Pass rendererPath or set SYNARA_PYDEXPI_SPIKE.",
    );
  }
  if (!isAbsolute(rendererPath)) {
    throw new Error("The pydexpi renderer path must be absolute.");
  }

  await mkdir(outputDir, { recursive: true });
  await invokeRenderer(
    input.execFile ?? execFilePromise,
    input.pythonPath ?? process.env.SYNARA_PYTHON ?? "python3",
    rendererPath,
    sourcePath,
    outputDir,
  );

  if (!(await isCompleteArtifact(paths))) {
    throw new Error("The pydexpi renderer completed without producing all artifacts.");
  }
  await validateArtifactContents(paths);

  const manifest = {
    protocolVersion: DEXPI_RENDERER_PROTOCOL_VERSION,
    sourceSha256,
    artifacts: {
      svg: basename(paths.svgPath),
      scene: basename(paths.scenePath),
      diagnostics: basename(paths.diagnosticsPath),
    },
  };
  await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { ...paths, sourceSha256, cached: false };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (
      flag === "--input" ||
      flag === "--output-dir" ||
      flag === "--renderer" ||
      flag === "--python"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} requires a value.`);
      }
      values[flag.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!values.input || !values.output_dir) {
    throw new Error(
      "Usage: dexpi-renderer.mjs --input drawing.xml --output-dir artifact [--renderer spike.py]",
    );
  }
  return values;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await renderDexpiSource({
      sourcePath: args.input,
      outputDir: args.output_dir,
      rendererPath: args.renderer ?? process.env.SYNARA_PYDEXPI_SPIKE,
      pythonPath: args.python,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
