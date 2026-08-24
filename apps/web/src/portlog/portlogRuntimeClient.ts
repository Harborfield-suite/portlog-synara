import type {
  PortLogRuntimeArtifact,
  PortLogRuntimeArtifactDescription,
  PortLogRuntimeContentReadInput,
  PortLogRuntimeContentReadResult,
  PortLogRuntimeContentWriteInput,
  PortLogRuntimeContentWriteResult,
  PortLogRuntimeEvent,
  PortLogRuntimeEvidence,
  PortLogRuntimeEvidenceGetInput,
  PortLogRuntimeEvidenceListInput,
  PortLogRuntimeEvidenceRecordInput,
  PortLogRuntimeFinding,
  PortLogRuntimeFindingListInput,
  PortLogRuntimeFindingRecordInput,
  PortLogRuntimeHealth,
  PortLogRuntimeHistoryInput,
  PortLogRuntimeHistoryPage,
  PortLogRuntimeModel,
  PortLogRuntimeOpenProjectInput,
  PortLogRuntimeProject,
  PortLogRuntimeProjectDescription,
  PortLogRuntimeSession,
  PortLogRuntimeSessionAttachInput,
  PortLogRuntimeSessionCreateInput,
  PortLogRuntimeSessionSnapshot,
  PortLogRuntimeState,
  PortLogRuntimeTurnAccepted,
  PortLogRuntimeTurnInput,
  PortLogRuntimeWorkspaceListResult,
} from "@synara/contracts";

export interface PortLogRuntimeClient {
  getStatus(): Promise<PortLogRuntimeState>;
  health(): Promise<PortLogRuntimeHealth>;
  listModels(): Promise<ReadonlyArray<PortLogRuntimeModel>>;
  openProject(input: PortLogRuntimeOpenProjectInput): Promise<PortLogRuntimeProject>;
  describeProject(input: { readonly projectId: string }): Promise<PortLogRuntimeProjectDescription>;
  listWorkspace(input: {
    readonly projectId: string;
    readonly relativePath?: string;
    readonly includeFiles?: boolean;
  }): Promise<PortLogRuntimeWorkspaceListResult>;
  listArtifacts(input: { readonly projectId: string }): Promise<ReadonlyArray<PortLogRuntimeArtifact>>;
  describeArtifact(input: {
    readonly projectId: string;
    readonly artifactId: string;
  }): Promise<PortLogRuntimeArtifactDescription>;
  readContent(input: PortLogRuntimeContentReadInput): Promise<PortLogRuntimeContentReadResult>;
  writeContent(input: PortLogRuntimeContentWriteInput): Promise<PortLogRuntimeContentWriteResult>;
  recordEvidence(input: PortLogRuntimeEvidenceRecordInput): Promise<PortLogRuntimeEvidence>;
  getEvidence(input: PortLogRuntimeEvidenceGetInput): Promise<PortLogRuntimeEvidence>;
  listEvidence(input: PortLogRuntimeEvidenceListInput): Promise<ReadonlyArray<PortLogRuntimeEvidence>>;
  recordFinding(input: PortLogRuntimeFindingRecordInput): Promise<PortLogRuntimeFinding>;
  listFindings(input: PortLogRuntimeFindingListInput): Promise<ReadonlyArray<PortLogRuntimeFinding>>;
  createSession(input: PortLogRuntimeSessionCreateInput): Promise<PortLogRuntimeSession>;
  sendTurn(input: PortLogRuntimeTurnInput): Promise<PortLogRuntimeTurnAccepted>;
  cancelTurn(input: { readonly sessionId: string; readonly turnId: string }): Promise<{ accepted: true }>;
  attachSession(input: PortLogRuntimeSessionAttachInput): Promise<PortLogRuntimeSessionSnapshot>;
  sessionHistory(input: PortLogRuntimeHistoryInput): Promise<PortLogRuntimeHistoryPage>;
  onEvent(listener: (event: PortLogRuntimeEvent) => void): () => void;
}

export function getPortLogRuntimeClient(): PortLogRuntimeClient | null {
  if (typeof window === "undefined") return null;
  const bridge = window.desktopBridge?.portlogRuntime;
  if (!bridge) return null;
  return {
    getStatus: () => bridge.getStatus(),
    health: () => bridge.health(),
    listModels: () => bridge.listModels(),
    openProject: (input) => bridge.openProject(input),
    describeProject: (input) => bridge.describeProject(input),
    listWorkspace: (input) => bridge.listWorkspace(input),
    listArtifacts: (input) => bridge.listArtifacts(input),
    describeArtifact: (input) => bridge.describeArtifact(input),
    readContent: (input) => bridge.readContent(input),
    writeContent: (input) => bridge.writeContent(input),
    recordEvidence: (input) => bridge.recordEvidence(input),
    getEvidence: (input) => bridge.getEvidence(input),
    listEvidence: (input) => bridge.listEvidence(input),
    recordFinding: (input) => bridge.recordFinding(input),
    listFindings: (input) => bridge.listFindings(input),
    createSession: (input) => bridge.createSession(input),
    sendTurn: (input) => bridge.sendTurn(input),
    cancelTurn: (input) => bridge.cancelTurn(input),
    attachSession: (input) => bridge.attachSession(input),
    sessionHistory: (input) => bridge.sessionHistory(input),
    onEvent: (listener) => bridge.onEvent(listener),
  };
}
