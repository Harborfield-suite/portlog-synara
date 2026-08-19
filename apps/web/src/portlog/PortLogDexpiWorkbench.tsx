import { useState } from "react";
import type { DesktopDexpiImportResult } from "@synara/contracts";

import { PortLogSvgPreview } from "./PortLogSvgPreview";

export function PortLogDexpiWorkbench() {
  const [artifact, setArtifact] = useState<DesktopDexpiImportResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const importSource = async () => {
    const bridge = window.desktopBridge?.dexpi;
    if (!bridge) {
      setStatus("DEXPI import is available in the desktop app.");
      return;
    }
    setImporting(true);
    setStatus(null);
    try {
      const nextArtifact = await bridge.importSource();
      if (nextArtifact) {
        setArtifact(nextArtifact);
        setStatus(nextArtifact.cached ? "Loaded cached drawing" : "Rendered drawing");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "DEXPI import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--color-background)]"
      data-portlog-craft="dexpi-svg"
      data-testid="portlog-dexpi-workbench"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/65 px-3 text-xs text-muted-foreground">
        <span className="mr-auto">DEXPI workbench</span>
        <button type="button" onClick={() => void importSource()} disabled={importing}>
          {importing ? "Importing…" : "Import DEXPI"}
        </button>
        {status ? <span role="status">{status}</span> : null}
      </div>
      {artifact ? (
        <PortLogSvgPreview svgPath={artifact.svgPath} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Import a DEXPI XML drawing to open its source-faithful SVG representation.
        </div>
      )}
    </div>
  );
}
