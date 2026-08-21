export const DEXPI_RENDERER_PROTOCOL_VERSION: 2;

export type DexpiArtifactPaths = {
  manifestPath: string;
  svgPath: string;
  scenePath: string;
  diagnosticsPath: string;
};

export type DexpiArtifactManifest = {
  protocolVersion: 1;
  sourceSha256: string;
  artifacts: {
    svg: "rendered.svg";
    scene: "scene.json";
    diagnostics: "diagnostics.json";
  };
};

export function resolveDexpiArtifactPaths(outputDir: string): DexpiArtifactPaths;
export function readDexpiArtifactManifest(
  manifestPath: string,
): Promise<DexpiArtifactManifest | null>;
export function renderDexpiSource(input: {
  sourcePath: string;
  outputDir?: string;
  cacheRoot?: string;
  rendererPath?: string;
  pythonPath?: string;
  execFile?: (
    command: string,
    args: string[],
    options: { cwd: string; maxBuffer: number },
  ) => Promise<unknown>;
}): Promise<DexpiArtifactPaths & { sourceSha256: string; cached: boolean }>;
