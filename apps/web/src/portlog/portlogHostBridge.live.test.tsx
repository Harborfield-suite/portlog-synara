import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PortLogEvidenceChip } from "./PortLogEvidenceChip";
import { PortLogRuleOutcomeChip } from "./PortLogRuleOutcomeChip";
import {
  adaptPortLogHostToolResult,
  formatPortLogEvidenceLine,
  parsePortLogEvidenceLine,
  resolvePortLogChromeFromWorkEntry,
} from "./portlogHostBridge";

describe("adaptPortLogHostToolResult (live PortLog shapes)", () => {
  it("maps portlog_evidence topology results to portlog authority chrome", () => {
    const chrome = adaptPortLogHostToolResult({
      tool: "portlog_evidence",
      result: {
        citations: ["entity:P-101", "entity:V-201"],
        sourceScopeIds: ["P-101", "V-201"],
        diagnostics: [],
        claim: "equipment around P-101",
      },
    });
    expect(chrome).toEqual({
      kind: "evidence",
      authority: "portlog",
      label: "E1",
      summary: "equipment around P-101 · entity:P-101 → entity:V-201",
      evidenceIds: ["entity:P-101", "entity:V-201"],
    });
  });

  it("maps wrapped prototype evidence envelopes with authority portlog", () => {
    const chrome = adaptPortLogHostToolResult({
      tool: "portlog_evidence",
      result: {
        source: "PortLog topology evidence",
        authority: "portlog",
        evidence: {
          artifactId: "topology",
          claim: "P-101 discharge path",
          citations: ["entity:P-101"],
          sourceScopeIds: ["P-101"],
          diagnostics: [],
          entities: [],
          relationships: [],
          uncertainty: null,
        },
      },
    });
    expect(chrome?.authority).toBe("portlog");
    expect(chrome?.kind).toBe("evidence");
    expect(chrome && "evidenceIds" in chrome ? chrome.evidenceIds : []).toEqual(["entity:P-101"]);
  });

  it("does not promote ordinary tool results to PortLog chrome", () => {
    expect(
      adaptPortLogHostToolResult({
        tool: "Bash",
        result: { authority: "portlog", citations: ["entity:P-101"] },
      }),
    ).toBeNull();
    expect(
      adaptPortLogHostToolResult({
        tool: "portlog_evidence",
        result: { authority: "ordinary", text: "workspace note" },
      }),
    ).toBeNull();
    expect(
      adaptPortLogHostToolResult({
        tool: "read",
        result: { content: "hello" },
      }),
    ).toBeNull();
  });

  it("maps portlog_rule_check deterministic results to deterministic chrome", () => {
    const chrome = adaptPortLogHostToolResult({
      tool: "portlog_rule_check",
      result: {
        authority: "deterministic",
        deterministic_result: {
          check_id: "pump_discharge_check_valve",
          outcome: "satisfied",
          scope: { requested_entity_id: "CentrifugalPump-1" },
        },
      },
    });
    expect(chrome).toEqual({
      kind: "rule",
      authority: "deterministic",
      label: "D1",
      summary: "pump_discharge_check_valve: satisfied (CentrifugalPump-1)",
      checkId: "pump_discharge_check_valve",
      outcome: "satisfied",
    });
  });
});

describe("resolvePortLogChromeFromWorkEntry", () => {
  it("parses JSON tool output from a Synara work-log entry", () => {
    const chrome = resolvePortLogChromeFromWorkEntry({
      toolName: "portlog_evidence",
      toolDetails: {
        kind: "command",
        title: "PortLog evidence",
        output: {
          output: JSON.stringify({
            citations: ["entity:P-101"],
            claim: "around P-101",
          }),
        },
      },
    });
    expect(chrome?.kind).toBe("evidence");
    expect(chrome?.authority).toBe("portlog");
  });
});

describe("marker + chip still work for evidence chrome", () => {
  it("formats adapted evidence into transcript markers ChatMarkdown understands", () => {
    const chrome = adaptPortLogHostToolResult({
      tool: "portlog_evidence",
      result: { citations: ["entity:P-101"], claim: "tag" },
    });
    expect(chrome?.kind).toBe("evidence");
    if (!chrome || chrome.kind !== "evidence") throw new Error("expected evidence");
    const line = formatPortLogEvidenceLine(chrome);
    expect(parsePortLogEvidenceLine(line)?.authority).toBe("portlog");
    const html = renderToStaticMarkup(
      <PortLogEvidenceChip label={chrome.label} summary={chrome.summary} />,
    );
    expect(html).toContain('data-portlog-authority="portlog"');
  });

  it("renders rule outcomes with deterministic authority", () => {
    const html = renderToStaticMarkup(
      <PortLogRuleOutcomeChip
        label="D1"
        summary="pump_discharge_check_valve: satisfied"
        outcome="satisfied"
      />,
    );
    expect(html).toContain('data-portlog-authority="deterministic"');
    expect(html).toContain("satisfied");
  });
});
