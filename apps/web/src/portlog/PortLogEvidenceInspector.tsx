import type {
  PortLogRuntimeEvidence,
  PortLogRuntimeFinding,
} from "@synara/contracts";
import { useEffect, useState } from "react";

import type { PortLogRuntimeClient } from "./portlogRuntimeClient";

export function PortLogEvidenceInspector(props: {
  client: PortLogRuntimeClient;
  projectId: string | null;
  onOpenEvidence: (evidence: PortLogRuntimeEvidence) => void;
}) {
  const [evidence, setEvidence] = useState<ReadonlyArray<PortLogRuntimeEvidence>>([]);
  const [findings, setFindings] = useState<ReadonlyArray<PortLogRuntimeFinding>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.projectId) {
      setEvidence([]);
      setFindings([]);
      return;
    }
    let active = true;
    void Promise.all([
      props.client.listEvidence({ projectId: props.projectId }),
      props.client.listFindings({ projectId: props.projectId }),
    ]).then(
      ([nextEvidence, nextFindings]) => {
        if (!active) return;
        setEvidence(nextEvidence);
        setFindings(nextFindings);
        setError(null);
      },
      (cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [props.client, props.projectId]);

  const openEvidence = async (item: PortLogRuntimeEvidence) => {
    try {
      const current = await props.client.getEvidence({
        projectId: item.projectId,
        evidenceId: item.evidenceId,
      });
      setEvidence((previous) => previous.map((candidate) => candidate.evidenceId === current.evidenceId ? current : candidate));
      props.onOpenEvidence(current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <details
      className="shrink-0 border-b border-border/65 bg-muted/10 px-3 py-2"
      data-testid="portlog-evidence-inspector"
    >
      <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground">
        Evidence & findings ({evidence.length} / {findings.length})
      </summary>
      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
        {evidence.map((item) => (
          <button
            key={item.evidenceId}
            type="button"
            className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-[11px] hover:bg-muted/50"
            onClick={() => void openEvidence(item)}
          >
            <span className="shrink-0 font-mono text-muted-foreground">{item.evidenceId.slice(0, 8)}</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{item.claim}</span>
            <span className="shrink-0 text-muted-foreground">
              {item.sourceChanged ? "source changed" : item.supportStatus}
            </span>
          </button>
        ))}
        {findings.map((item) => (
          <div key={item.findingId} className="rounded-md border border-border/60 px-2 py-1 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-foreground">{item.title}</span>
              <span className="shrink-0 text-muted-foreground">{item.claimStatus}</span>
            </div>
            <p className="truncate text-muted-foreground">{item.summary}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {item.evidenceIds.map((evidenceId) => {
                const evidenceRecord = evidence.find((candidate) => candidate.evidenceId === evidenceId);
                return evidenceRecord ? (
                  <button
                    key={evidenceId}
                    type="button"
                    className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted/60"
                    onClick={() => void openEvidence(evidence)}
                  >
                    {evidenceId.slice(0, 8)}
                  </button>
                ) : null;
              })}
            </div>
          </div>
        ))}
        {!error && evidence.length === 0 && findings.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No PortLog evidence recorded yet.</p>
        ) : null}
      </div>
    </details>
  );
}
