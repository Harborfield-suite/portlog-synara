// FILE: PortLogTranscriptSegments.tsx
// Purpose: Render assistant text with PortLog evidence lines as distinct chrome.
// Layer: Web chat presentation (spike seam into transcript)

import type { ReactNode } from "react";

import { PortLogEvidenceChip } from "./PortLogEvidenceChip";
import { splitPortLogTranscriptSegments } from "./portlogHostBridge";

export function PortLogTranscriptSegments(props: {
  text: string;
  renderOrdinary: (text: string) => ReactNode;
}) {
  const segments = splitPortLogTranscriptSegments(props.text);
  if (segments.length === 1 && segments[0]?.kind === "ordinary") {
    return <>{props.renderOrdinary(segments[0].text)}</>;
  }
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "portlog-evidence") {
          return (
            <PortLogEvidenceChip
              key={`portlog-evidence-${segment.label}-${index}`}
              label={segment.label}
              summary={segment.summary}
            />
          );
        }
        return (
          <div key={`ordinary-${index}`}>{props.renderOrdinary(segment.text)}</div>
        );
      })}
    </>
  );
}
