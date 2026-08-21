// FILE: PortLogEvidenceChip.tsx
// Purpose: Transcript chrome for PortLog-authoritative evidence (spike demo).
// Layer: Web chat presentation

import { authorityDataAttribute } from "./portlogHostBridge";

export function PortLogEvidenceChip(props: { label: string; summary: string }) {
  return (
    <div
      data-portlog-authority={authorityDataAttribute("portlog")}
      data-portlog-evidence-label={props.label}
      className="my-2 rounded-md border border-emerald-600/50 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-100"
      role="status"
    >
      <div className="font-semibold tracking-wide">
        PortLog evidence [{props.label}]
      </div>
      <div className="mt-0.5 opacity-90">{props.summary}</div>
    </div>
  );
}

/** Ordinary (non-authoritative) context for contrast in spike tests. */
export function OrdinaryContextLine(props: { text: string }) {
  return (
    <div
      data-portlog-authority={authorityDataAttribute("ordinary")}
      className="my-1 text-sm opacity-80"
    >
      {props.text}
    </div>
  );
}
