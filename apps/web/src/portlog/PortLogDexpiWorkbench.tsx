import { isWorkspaceRelativePathSafe, joinWorkspaceRelativePath } from "@synara/shared/path";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesktopDexpiImportInput, DesktopDexpiImportResult } from "@synara/contracts";

import { PortLogEntityInspector, parsePortLogDexpiEntities } from "./PortLogEntityInspector";
import { PortLogSvgPreview } from "./PortLogSvgPreview";
import { isPortLogPrimaryDrawingPath } from "./portlogWorkspaceArtifacts";
import { usePortLogLocalFile } from "./usePortLogLocalFile";

export function PortLogDexpiWorkbench(props: {
  sourcePath?: string | null;
  sourceCwd?: string | null;
}) {
  const [artifact, setArtifact] = useState<DesktopDexpiImportResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const browserSvgPath = useMemo(() => {
    if (
      !props.sourceCwd ||
      !props.sourcePath ||
      !isWorkspaceRelativePathSafe(props.sourcePath) ||
      !/\.xml$/iu.test(props.sourcePath)
    ) {
      return null;
    }
    return joinWorkspaceRelativePath(props.sourceCwd, props.sourcePath.replace(/\.xml$/iu, ".svg"));
  }, [props.sourceCwd, props.sourcePath]);
  const hasDesktopRenderer = typeof window !== "undefined" && Boolean(window.desktopBridge?.dexpi);

  const importSource = useCallback(async (input?: DesktopDexpiImportInput) => {
    const bridge = window.desktopBridge?.dexpi;
    if (!bridge) {
      setStatus(
        "Process drawing rendering is available in the desktop app; raw XML remains available in Files.",
      );
      return;
    }
    setImporting(true);
    setStatus(null);
    try {
      const nextArtifact = await bridge.importSource(input);
      if (nextArtifact) {
        setArtifact(nextArtifact);
        setSelectedEntityId(null);
        setStatus(nextArtifact.cached ? "Loaded cached drawing" : "Rendered drawing");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "DEXPI import failed.");
    } finally {
      setImporting(false);
    }
  }, []);

  useEffect(() => {
    if (!props.sourcePath || !isPortLogPrimaryDrawingPath(props.sourcePath)) return;
    setArtifact(null);
    const input: DesktopDexpiImportInput = {
      sourcePath: props.sourcePath,
      ...(props.sourceCwd ? { cwd: props.sourceCwd } : {}),
    };
    void importSource(input);
  }, [importSource, props.sourceCwd, props.sourcePath]);

  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--color-background)]"
      data-portlog-craft="dexpi-svg"
      data-testid="portlog-dexpi-workbench"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/65 px-3 text-xs text-muted-foreground">
        <span className="mr-auto">DEXPI process drawing</span>
        <button type="button" onClick={() => void importSource()} disabled={importing}>
          {importing ? "Importing…" : "Import process drawing"}
        </button>
        {status ? <span role="status">{status}</span> : null}
      </div>
      {artifact ? (
        <ImportedDexpiArtifact
          artifact={artifact}
          selectedEntityId={selectedEntityId}
          onEntitySelect={setSelectedEntityId}
        />
      ) : !hasDesktopRenderer && browserSvgPath ? (
        <PortLogSvgPreview svgPath={browserSvgPath} onEntitySelect={setSelectedEntityId} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Import a DEXPI XML drawing to open its source-faithful SVG representation.
        </div>
      )}
    </div>
  );
}

function ImportedDexpiArtifact(props: {
  artifact: DesktopDexpiImportResult;
  selectedEntityId: string | null;
  onEntitySelect: (entityId: string | null) => void;
}) {
  const sceneFile = usePortLogLocalFile(props.artifact.scenePath);
  const entities = useMemo(
    () => parsePortLogDexpiEntities(sceneFile.contents),
    [sceneFile.contents],
  );

  return (
    <div className="flex min-h-0 flex-1">
      <PortLogSvgPreview
        svgPath={props.artifact.svgPath}
        selectedEntityId={props.selectedEntityId}
        onEntitySelect={props.onEntitySelect}
      />
      <PortLogEntityInspector
        entity={props.selectedEntityId ? entities[props.selectedEntityId] : undefined}
        entities={entities}
      />
    </div>
  );
}
