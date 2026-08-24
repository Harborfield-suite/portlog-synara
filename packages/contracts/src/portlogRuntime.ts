export type PortLogRuntimeStatus = "starting" | "ready" | "stopping" | "stopped" | "error";

export interface PortLogRuntimeCapabilities {
  readonly tools: readonly ["read", "write", "edit", "bash"];
  readonly filesystemSandbox: false;
  readonly toolApproval: false;
  readonly shellAccess: "unrestricted-user-permissions";
}

export interface PortLogRuntimeReady {
  readonly protocolVersion: 1;
  readonly runtimeVersion: string;
  readonly runtimeInstanceId: string;
  readonly piVersion: string;
  readonly capabilities: PortLogRuntimeCapabilities;
}

export interface PortLogRuntimeState {
  readonly status: PortLogRuntimeStatus;
  readonly ready: PortLogRuntimeReady | null;
  readonly error: string | null;
}

export interface PortLogRuntimeHealth {
  readonly healthy: boolean;
  readonly status: PortLogRuntimeStatus;
  readonly runtimeInstanceId: string | null;
}

export type PortLogRuntimeModelStatus = "ready" | "needs_auth" | "unavailable";

export interface PortLogRuntimeModel {
  readonly ref: string;
  readonly providerId: string;
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly status: PortLogRuntimeModelStatus;
  readonly contextWindow?: number;
  readonly reasoning?: boolean;
  readonly thinkingLevels?: readonly string[];
}

export interface PortLogRuntimeProject {
  readonly projectId: string;
  readonly root: string;
}

export interface PortLogRuntimeOpenProjectInput {
  readonly root: string;
  readonly createIfMissing?: boolean;
}

export interface PortLogRuntimeProjectDescription extends PortLogRuntimeProject {
  readonly name: string;
  readonly description?: string;
  readonly manifestLocator?: string;
}

export interface PortLogRuntimeProjectDescribeInput {
  readonly projectId: string;
}

export interface PortLogRuntimeWorkspaceEntry {
  readonly locator: string;
  readonly relativePath: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly sizeBytes?: number;
}

export interface PortLogRuntimeWorkspaceListInput {
  readonly projectId: string;
  readonly relativePath?: string;
  readonly includeFiles?: boolean;
}

export interface PortLogRuntimeWorkspaceListResult {
  readonly projectId: string;
  readonly entries: readonly PortLogRuntimeWorkspaceEntry[];
}

export interface PortLogRuntimeArtifact {
  readonly artifactId: string;
  readonly projectId: string;
  readonly kind: string;
  readonly locator: string;
  readonly relativePath: string;
  readonly name: string;
  readonly description?: string;
  readonly sizeBytes: number;
}

export interface PortLogRuntimeArtifactDescription extends PortLogRuntimeArtifact {
  readonly sha256: string;
}

export type PortLogRuntimeClaimStatus = "satisfied" | "violated" | "indeterminate";
export type PortLogRuntimeEvidenceSupportStatus =
  | "unverified"
  | "supported"
  | "incomplete"
  | "conflicting";

export interface PortLogRuntimeEvidence {
  readonly evidenceId: string;
  readonly projectId: string;
  readonly artifactId?: string;
  readonly sourceLocator: string;
  readonly sourceIdentity: string;
  readonly sourceSha256: string;
  readonly claim: string;
  readonly claimStatus: PortLogRuntimeClaimStatus;
  readonly supportStatus: PortLogRuntimeEvidenceSupportStatus;
  readonly createdByTurn?: string;
  readonly createdAt: string;
  readonly sourceChanged?: boolean;
}

export interface PortLogRuntimeEvidenceRecordInput {
  readonly projectId: string;
  readonly artifactId?: string;
  readonly sourceLocator: string;
  readonly sourceIdentity: string;
  readonly sourceSha256: string;
  readonly claim: string;
  readonly claimStatus: PortLogRuntimeClaimStatus;
  readonly supportStatus: PortLogRuntimeEvidenceSupportStatus;
  readonly createdByTurn?: string;
}

export interface PortLogRuntimeEvidenceGetInput {
  readonly projectId: string;
  readonly evidenceId: string;
}

export interface PortLogRuntimeEvidenceListInput {
  readonly projectId: string;
}

export type PortLogRuntimeFindingStatus = "open" | "resolved" | "dismissed";

export interface PortLogRuntimeFinding {
  readonly findingId: string;
  readonly projectId: string;
  readonly sessionId?: string;
  readonly title: string;
  readonly summary: string;
  readonly claimStatus: PortLogRuntimeClaimStatus;
  readonly status: PortLogRuntimeFindingStatus;
  readonly evidenceIds: readonly string[];
  readonly createdByTurn?: string;
  readonly createdAt: string;
}

export interface PortLogRuntimeFindingRecordInput {
  readonly projectId: string;
  readonly sessionId?: string;
  readonly title: string;
  readonly summary: string;
  readonly claimStatus: PortLogRuntimeClaimStatus;
  readonly status?: PortLogRuntimeFindingStatus;
  readonly evidenceIds?: readonly string[];
  readonly createdByTurn?: string;
}

export interface PortLogRuntimeFindingListInput {
  readonly projectId: string;
  readonly sessionId?: string;
}

export interface PortLogRuntimeArtifactListInput {
  readonly projectId: string;
}

export interface PortLogRuntimeArtifactDescribeInput {
  readonly projectId: string;
  readonly artifactId: string;
}

export interface PortLogRuntimeContentReadInput {
  readonly locator: string;
  readonly offset?: number;
  readonly maxBytes?: number;
}

export interface PortLogRuntimeContentReadResult {
  readonly locator: string;
  readonly relativePath: string;
  readonly contents: string;
  readonly offset: number;
  readonly totalBytes: number;
  readonly truncated: boolean;
  readonly version?: string | null;
}

export interface PortLogRuntimeContentWriteInput {
  readonly projectId: string;
  readonly relativePath: string;
  readonly contents: string;
  readonly expectedVersion?: string | null;
}

export interface PortLogRuntimeContentWriteResult {
  readonly projectId: string;
  readonly relativePath: string;
  readonly version: string;
}

export interface PortLogRuntimeSessionCreateInput {
  readonly projectId: string;
  readonly modelRef: string;
  readonly thinkingLevel?: string;
}

export interface PortLogRuntimeTurnInput {
  readonly sessionId: string;
  readonly turnId: string;
  readonly text: string;
  readonly modelRef?: string;
  readonly thinkingLevel?: string;
}

export interface PortLogRuntimeSession {
  readonly sessionId: string;
  readonly projectId: string;
  readonly modelRef: string;
  readonly thinkingLevel: string;
}

export interface PortLogRuntimeTurnAccepted {
  readonly accepted: true;
  readonly sessionId: string;
  readonly turnId: string;
}

export interface PortLogRuntimeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly totalTokens: number;
  readonly cost: number;
}

export interface PortLogRuntimeTurnSummary {
  readonly turnId: string;
  readonly sessionId: string;
  readonly modelRef: string;
  readonly thinkingLevel: string;
  readonly state: "accepted" | "running" | "completed" | "cancelled" | "interrupted" | "failed";
}

export interface PortLogRuntimeSessionSnapshot {
  readonly sessionId: string;
  readonly streamId: string;
  readonly cursor: number;
  readonly state: "idle" | "active" | "interrupted";
  readonly activeTurnId?: string;
  readonly events: readonly PortLogRuntimeEvent[];
}

export interface PortLogRuntimeSessionAttachInput {
  readonly sessionId: string;
  readonly streamId?: string;
  readonly afterCursor?: number;
}

export interface PortLogRuntimeHistoryInput {
  readonly sessionId: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface PortLogRuntimeHistoryPage {
  readonly sessionId: string;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly turns: readonly PortLogRuntimeTurnSummary[];
}

export interface PortLogRuntimeEventBase {
  readonly streamId: string;
  readonly cursor: number;
  readonly sessionId: string;
  readonly turnId?: string;
}

export type PortLogRuntimeEvent =
  | (PortLogRuntimeEventBase & {
      readonly type: "assistant.delta";
      readonly delta: string;
    })
  | (PortLogRuntimeEventBase & {
      readonly type: "tool.started";
      readonly toolCallId: string;
      readonly toolName: string;
    })
  | (PortLogRuntimeEventBase & {
      readonly type: "tool.completed";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly status: "completed" | "failed";
      readonly preview?: string;
    })
  | (PortLogRuntimeEventBase & {
      readonly type: "turn.completed";
      readonly state: "completed" | "cancelled" | "failed";
      readonly errorMessage?: string;
      readonly usage?: PortLogRuntimeUsage;
    })
  | (PortLogRuntimeEventBase & {
      readonly type: "runtime.error";
      readonly code: string;
      readonly message: string;
    });
