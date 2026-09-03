import type { ComponentContext } from "./architecture";
import type { HarnessRunState } from "./engineering-run";
import type {
  AgentGraphContextReceipt,
  AgentExperienceRecord,
  GraphImpactReviewReceipt,
} from "./agent-graph-tools";
export type AgentMode = "ask" | "change";
export type AgentProviderId = "codex" | "claude";
export type AgentProviderCapabilities = {
  modes: AgentMode[];
  streaming: boolean;
  toolEvents: boolean;
  fileChanges: boolean;
  approvals: boolean;
  questions: boolean;
  sessionResume: boolean;
  fork: boolean;
  modelSelection: boolean;
  thinkingSelection: boolean;
  permissionModes: boolean;
};
export type AgentProviderDescriptor = {
  id: AgentProviderId;
  label: string;
  available: boolean;
  message: string;
  capabilities: AgentProviderCapabilities;
};
export type AgentNativeSessionRef = {
  providerId: AgentProviderId;
  sessionId: string;
  turnId?: string;
};
export type AgentEngineeringRunSummary = {
  contract: "witch.engineering-run/v1";
  state: HarnessRunState;
  eventCount: number;
  lastSequence: number;
  eventDigest: string;
  checkpointCount: number;
  verificationPassed: number;
  verificationFailed: number;
  repairAttempts: number;
  planUnexpectedFiles: number;
  repairStopReason?:
    "same-fingerprint" | "budget-exhausted" | "provider-interrupted";
  analysisStatus?: "completed" | "failed" | "skipped";
  analysisChangedNodes?: number;
  analysisChangedRelations?: number;
  impactAffectedNodes?: number;
  impactRiskScore?: number;
  impactRiskLevel?: GraphImpactReviewReceipt["risk"]["level"];
  experienceCount: number;
  latestExperienceOutcome?: AgentExperienceRecord["outcome"];
  healthy: boolean;
  error?: string;
};
export type AgentHostStatus = {
  defaultProviderId: AgentProviderId;
  activeProviderId?: AgentProviderId;
  providers: AgentProviderDescriptor[];
};
export type AgentRunStatus =
  | "preparing"
  | "running"
  | "review"
  | "completed"
  | "interrupted"
  | "failed"
  | "applied"
  | "archived";
export type ProposedChange = {
  path: string;
  before: string | null;
  after: string | null;
  beforeHash: string | null;
  afterHash: string | null;
};
export type AgentRun = {
  id: string;
  providerId: AgentProviderId;
  providerLabel: string;
  nativeSession?: AgentNativeSessionRef;
  workspaceRoot: string;
  workspaceName: string;
  prompt: string;
  mode: AgentMode;
  contexts: ComponentContext[];
  graphContext?: AgentGraphContextReceipt;
  graphImpact?: GraphImpactReviewReceipt;
  experiences?: AgentExperienceRecord[];
  status: AgentRunStatus;
  createdAt: string;
  completedAt?: string;
  response: string;
  error?: string;
  activity: string[];
  changes: ProposedChange[];
  isolation: "read-only" | "workspace-copy";
  stagingRoot?: string;
  appliedPaths?: string[];
  archivePath?: string;
  archivedAt?: string;
  parentRunId?: string;
  engineering?: AgentEngineeringRunSummary;
};
export type AgentEvent = { run: AgentRun };
export type AgentRequest = {
  prompt: string;
  mode: AgentMode;
  contexts: ComponentContext[];
  providerId?: AgentProviderId;
};
