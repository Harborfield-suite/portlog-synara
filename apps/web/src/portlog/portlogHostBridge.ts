// FILE: portlogHostBridge.ts
// Purpose: No-op PortLog host→transcript bridge for the Synara fork spike.
//          Formats authority-distinct evidence lines without calling PortLog core.
// Layer: Web presentation adapter (spike)
// Exports: authority types, formatters, parsers used by transcript chrome

export type PortLogAuthority = "ordinary" | "portlog" | "deterministic";

export interface PortLogEvidenceEvent {
  readonly label: string;
  readonly summary: string;
  readonly sourceDigest?: string;
}

const EVIDENCE_LINE_RE =
  /^\[portlog:evidence\|(?<label>[^|\]]+)\|(?<summary>[^\]]*)\](?<rest>.*)$/;

/** Format a PortLog-authoritative evidence line for transcript chrome. */
export function formatPortLogEvidenceLine(event: PortLogEvidenceEvent): string {
  const label = event.label.trim() || "E?";
  const summary = event.summary.trim() || "(no summary)";
  const digest =
    event.sourceDigest && event.sourceDigest.trim().length > 0
      ? ` digest=${event.sourceDigest.trim()}`
      : "";
  return `[portlog:evidence|${label}|${summary}${digest}]`;
}

export function parsePortLogEvidenceLine(
  line: string,
): { label: string; summary: string; authority: "portlog" } | null {
  const match = EVIDENCE_LINE_RE.exec(line.trim());
  if (!match?.groups) return null;
  return {
    label: match.groups.label.trim(),
    summary: match.groups.summary.trim(),
    authority: "portlog",
  };
}

/** Split transcript text into ordinary markdown vs PortLog evidence lines. */
export function splitPortLogTranscriptSegments(text: string): Array<
  | { kind: "ordinary"; text: string }
  | { kind: "portlog-evidence"; label: string; summary: string }
> {
  if (!text.includes("[portlog:evidence|")) {
    return [{ kind: "ordinary", text }];
  }
  const segments: Array<
    | { kind: "ordinary"; text: string }
    | { kind: "portlog-evidence"; label: string; summary: string }
  > = [];
  let ordinaryBuffer = "";
  for (const rawLine of text.split("\n")) {
    const parsed = parsePortLogEvidenceLine(rawLine);
    if (parsed) {
      if (ordinaryBuffer.length > 0) {
        segments.push({ kind: "ordinary", text: ordinaryBuffer });
        ordinaryBuffer = "";
      }
      segments.push({
        kind: "portlog-evidence",
        label: parsed.label,
        summary: parsed.summary,
      });
      continue;
    }
    ordinaryBuffer = ordinaryBuffer.length > 0 ? `${ordinaryBuffer}\n${rawLine}` : rawLine;
  }
  if (ordinaryBuffer.length > 0) {
    segments.push({ kind: "ordinary", text: ordinaryBuffer });
  }
  return segments.length > 0 ? segments : [{ kind: "ordinary", text }];
}

export function authorityDataAttribute(authority: PortLogAuthority): string {
  return authority;
}
