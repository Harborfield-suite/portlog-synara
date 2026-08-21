// FILE: portlogHostBridge.ts
// Purpose: PortLog host→Synara transcript bridge.
//          Adapts real PortLog tool results into authority-distinct chrome.
// Layer: Web presentation adapter
// Exports: authority types, formatters, parsers, adapters used by transcript chrome

export type PortLogAuthority = "ordinary" | "portlog" | "deterministic";

export interface PortLogEvidenceEvent {
  readonly label: string;
  readonly summary: string;
  readonly sourceDigest?: string;
  readonly evidenceIds?: readonly string[];
}

export type PortLogTranscriptChrome =
  | {
      kind: "evidence";
      authority: "portlog";
      label: string;
      summary: string;
      evidenceIds: readonly string[];
      sourceDigest?: string;
    }
  | {
      kind: "rule";
      authority: "deterministic";
      label: string;
      summary: string;
      checkId: string;
      outcome: string;
    };

const EVIDENCE_LINE_RE =
  /^\[portlog:evidence\|(?<label>[^|\]]+)\|(?<summary>[^\]]*)\](?<rest>.*)$/;

const PORTLOG_EVIDENCE_TOOLS = new Set(["portlog_evidence", "portlog_workspace_read"]);
const PORTLOG_RULE_TOOLS = new Set(["portlog_rule_check"]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function collectEvidenceIds(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectEvidenceIds(item, depth + 1));
  if (!isRecord(value)) return [];
  // Prefer explicit citation fields (match PortLog readEvidenceIds priority).
  const preferred = [
    ...asStringArray(value.citations),
    ...asStringArray(value.evidenceIds),
    ...asStringArray(value.evidence_ids),
    ...asStringArray(value.ordered_topology_ids),
  ];
  if (preferred.length > 0) {
    return unique([
      ...preferred,
      ...(isRecord(value.evidence) ? collectEvidenceIds(value.evidence, depth + 1) : []),
    ]);
  }
  return unique([
    ...asStringArray(value.sourceScopeIds),
    ...Object.values(value).flatMap((item) => collectEvidenceIds(item, depth + 1)),
  ]);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeToolName(tool: string | undefined): string {
  return (tool ?? "").trim().toLowerCase();
}

function readAuthority(result: unknown): PortLogAuthority | null {
  if (!isRecord(result)) return null;
  const raw = result.authority;
  if (raw === "ordinary" || raw === "portlog" || raw === "deterministic") return raw;
  return null;
}

function unwrapEvidencePayload(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) return null;
  if (isRecord(result.evidence)) return result.evidence;
  return result;
}

function adaptEvidenceResult(result: unknown): PortLogTranscriptChrome | null {
  const authority = readAuthority(result);
  if (authority === "ordinary") return null;

  const payload = unwrapEvidencePayload(result);
  if (!payload) return null;

  // Explicit ordinary nested envelope
  if (readAuthority(payload) === "ordinary") return null;

  const evidenceIds = unique(collectEvidenceIds(result));
  const claim =
    (typeof payload.claim === "string" && payload.claim.trim()) ||
    (typeof payload.source === "string" && payload.source.trim()) ||
    "PortLog topology evidence";
  const summary =
    evidenceIds.length > 0 ? `${claim} · ${evidenceIds.join(" → ")}` : claim;

  // Require either explicit portlog authority or evidence-shaped citations.
  if (authority !== "portlog" && evidenceIds.length === 0 && !("artifactId" in payload)) {
    return null;
  }
  if (authority !== null && authority !== "portlog") return null;

  return {
    kind: "evidence",
    authority: "portlog",
    label: "E1",
    summary,
    evidenceIds,
    ...(typeof payload.document_preparation_digest === "string"
      ? { sourceDigest: payload.document_preparation_digest }
      : typeof result === "object" &&
          result &&
          "document_preparation_digest" in result &&
          typeof (result as { document_preparation_digest?: unknown }).document_preparation_digest ===
            "string"
        ? {
            sourceDigest: (result as { document_preparation_digest: string })
              .document_preparation_digest,
          }
        : {}),
  };
}

function adaptRuleResult(result: unknown): PortLogTranscriptChrome | null {
  if (!isRecord(result)) return null;
  const deterministic = isRecord(result.deterministic_result)
    ? result.deterministic_result
    : isRecord(result.rule)
      ? result
      : result;
  const checkId =
    (typeof deterministic.check_id === "string" && deterministic.check_id) ||
    (isRecord(result.rule) && typeof result.rule.check_id === "string" && result.rule.check_id) ||
    "rule";
  const outcome =
    (typeof deterministic.outcome === "string" && deterministic.outcome) ||
    (typeof result.outcome === "string" && result.outcome) ||
    "indeterminate";
  const scope = isRecord(deterministic.scope) ? deterministic.scope : {};
  const scopeId =
    (typeof scope.requested_entity_id === "string" && scope.requested_entity_id) ||
    (typeof scope.pump_id === "string" && scope.pump_id) ||
    null;
  const summary = scopeId ? `${checkId}: ${outcome} (${scopeId})` : `${checkId}: ${outcome}`;

  // Only accept known PortLog rule tools' envelopes (authority optional but if
  // present must be deterministic / governed-check-engine).
  const authority = readAuthority(result);
  if (authority === "ordinary" || authority === "portlog") return null;

  return {
    kind: "rule",
    authority: "deterministic",
    label: "D1",
    summary,
    checkId,
    outcome,
  };
}

/**
 * Adapt a PortLog host tool result into Synara transcript chrome.
 * Returns null when the tool/result must stay ordinary.
 */
export function adaptPortLogHostToolResult(input: {
  tool: string;
  result: unknown;
}): PortLogTranscriptChrome | null {
  const tool = normalizeToolName(input.tool);
  if (PORTLOG_EVIDENCE_TOOLS.has(tool)) {
    // workspace_read is ordinary by product policy unless marked portlog — skip unless evidence-shaped + authority
    if (tool === "portlog_workspace_read") {
      return readAuthority(input.result) === "portlog" ? adaptEvidenceResult(input.result) : null;
    }
    return adaptEvidenceResult(input.result);
  }
  if (PORTLOG_RULE_TOOLS.has(tool)) {
    return adaptRuleResult(input.result);
  }
  return null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractResultCandidate(entry: {
  preview?: string;
  detail?: string;
  toolDetails?: {
    output?: { output?: string; stdout?: string; stderr?: string };
    content?: string;
  };
}): unknown {
  const strings = [
    entry.toolDetails?.output?.output,
    entry.toolDetails?.output?.stdout,
    entry.toolDetails?.content,
    entry.preview,
    entry.detail,
  ];
  for (const value of strings) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const parsed = tryParseJson(value.trim());
    if (parsed !== null) return parsed;
  }
  return null;
}

/** Resolve chrome from a Synara work-log tool row when it carries PortLog JSON. */
export function resolvePortLogChromeFromWorkEntry(entry: {
  toolName?: string;
  label?: string;
  toolTitle?: string;
  preview?: string;
  detail?: string;
  toolDetails?: {
    kind?: string;
    title?: string;
    output?: { output?: string; stdout?: string; stderr?: string };
    content?: string;
  };
}): PortLogTranscriptChrome | null {
  const tool =
    entry.toolName ||
    (/\bportlog_evidence\b/i.test(entry.label ?? "")
      ? "portlog_evidence"
      : /\bportlog_rule_check\b/i.test(entry.label ?? "")
        ? "portlog_rule_check"
        : /\bportlog_evidence\b/i.test(entry.toolTitle ?? "")
          ? "portlog_evidence"
          : /\bportlog_rule_check\b/i.test(entry.toolTitle ?? "")
            ? "portlog_rule_check"
            : "");
  if (!tool) return null;
  const result = extractResultCandidate(entry);
  if (result === null) return null;
  return adaptPortLogHostToolResult({ tool, result });
}
