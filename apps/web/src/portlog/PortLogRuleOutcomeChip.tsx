// FILE: PortLogRuleOutcomeChip.tsx
// Purpose: Transcript chrome for PortLog deterministic rule outcomes.
// Layer: Web chat presentation

import { authorityDataAttribute } from "./portlogHostBridge";

export function PortLogRuleOutcomeChip(props: {
  label: string;
  summary: string;
  outcome: "satisfied" | "violated" | "indeterminate" | string;
}) {
  const tone =
    props.outcome === "satisfied"
      ? "border-sky-600/50 bg-sky-950/40 text-sky-100"
      : props.outcome === "violated"
        ? "border-rose-600/50 bg-rose-950/40 text-rose-100"
        : "border-amber-600/50 bg-amber-950/40 text-amber-100";
  return (
    <div
      data-portlog-authority={authorityDataAttribute("deterministic")}
      data-portlog-rule-outcome={props.outcome}
      data-portlog-rule-label={props.label}
      className={`my-2 rounded-md border px-3 py-2 text-sm ${tone}`}
      role="status"
    >
      <div className="font-semibold tracking-wide">
        PortLog rule [{props.label}] · {props.outcome}
      </div>
      <div className="mt-0.5 opacity-90">{props.summary}</div>
    </div>
  );
}
