import type {
  AgentMode,
  AgentNativeSessionRef,
  AgentProviderId,
  AgentRun,
} from "./agent";

export type HarnessRunState =
  | "created"
  | "context-planning"
  | "planning"
  | "awaiting-approval"
  | "executing"
  | "verifying"
  | "repairing"
  | "review-ready"
  | "completed"
  | "applied"
  | "archived"
  | "failed"
  | "interrupted"
  | "attention-required";

export type RunBudget = {
  wallTimeMs: number;
  providerTurns: number;
  tokenEstimate?: number;
  maxChangedFiles: number;
  maxChangedBytes: number;
  maxProcesses: number;
  maxRepairAttempts: number;
  maxToolRequests: number;
};

export type RunBudgetUsage = {
  wallTimeMs: number;
  providerTurns: number;
  tokenEstimate?: number;
  changedFiles: number;
  changedBytes: number;
  processes: number;
  repairAttempts: number;
  toolRequests: number;
};

export type ContextSelectionReason =
  | "user-selected"
  | "direct-relation"
  | "workflow-step"
  | "behavior-flow"
  | "verification-target"
  | "open-question";

export type ContextSelection = {
  subjectId: string;
  reason: ContextSelectionReason;
  evidenceIds: string[];
  priority: number;
};

export type VerificationKind =
  | "syntax"
  | "typecheck"
  | "lint"
  | "unit-test"
  | "build"
  | "architecture"
  | "semantic"
  | "custom-task";

export type VerificationIntent = {
  id: string;
  kind: VerificationKind;
  commandId?: string;
  scope: string[];
  required: boolean;
};

export type EngineeringPlan = {
  objective: string;
  assumptions: string[];
  affectedComponents: string[];
  expectedFiles: string[];
  steps: Array<{
    id: string;
    description: string;
    expectedOutcome: string;
  }>;
  verification: VerificationIntent[];
  risks: string[];
};

export type PlanEvaluation = {
  expectedFiles: string[];
  actualFiles: string[];
  unexpectedFiles: string[];
  missingFiles: string[];
  evaluatedAt: string;
};

export type RepairAttemptReceipt = {
  attempt: number;
  fingerprint: string;
  failedIntentIds: string[];
  status: "started" | "passed" | "failed" | "interrupted";
  startedAt: string;
  completedAt?: string;
  checkpointId?: string;
};

export type VerificationReceipt = {
  intentId: string;
  status: "passed" | "failed" | "skipped" | "blocked";
  startedAt: string;
  completedAt: string;
  exitCode?: number;
  outputHash?: string;
  boundedOutput?: string;
  changedRevision?: string;
};

export type AnalysisUpdateReceipt = {
  status: "completed" | "failed" | "skipped";
  beforeRevision: string;
  afterRevision?: string;
  invalidatedPaths: string[];
  changedNodes?: number;
  changedRelations?: number;
  completedAt: string;
  error?: string;
};

export type ToolCapability =
  "read" | "write-isolated" | "process" | "network" | "apply";

export type ToolRequest = {
  id: string;
  toolId: string;
  capability: ToolCapability;
  argumentsHash: string;
  scope: string[];
  reason: string;
};

export type PolicyDecision = {
  requestId: string;
  decision: "allow" | "deny" | "ask";
  policyId: string;
  reason: string;
  budgetDelta?: Partial<RunBudgetUsage>;
};

export type HarnessEventType =
  | "run.created"
  | "context.selected"
  | "plan.created"
  | "plan.evaluated"
  | "state.changed"
  | "approval.requested"
  | "approval.resolved"
  | "provider.session"
  | "provider.message"
  | "tool.requested"
  | "tool.started"
  | "tool.completed"
  | "file.changed"
  | "checkpoint.created"
  | "verification.completed"
  | "repair.started"
  | "repair.completed"
  | "repair.stopped"
  | "analysis.updated"
  | "review.created"
  | "run.completed"
  | "run.failed";

export type RunCreatedPayload = {
  contract: "witch.engineering-run/v1";
  schemaVersion: 1;
  runId: string;
  parentRunId?: string;
  workspaceRoot: string;
  workspaceName: string;
  sourceRevision: string;
  providerId: AgentProviderId;
  providerLabel: string;
  mode: AgentMode;
  goal: string;
  createdAt: string;
  budget: RunBudget;
  nativeSession?: AgentNativeSessionRef;
  legacy?: {
    contract: "witch.agent-run/v0";
    runId: string;
    originalStatus: AgentRun["status"];
  };
};

export type HarnessEventPayloads = {
  "run.created": RunCreatedPayload;
  "context.selected": ContextSelection;
  "plan.created": { plan: EngineeringPlan };
  "plan.evaluated": { evaluation: PlanEvaluation };
  "state.changed": {
    from: HarnessRunState;
    to: HarnessRunState;
    reason?: string;
  };
  "approval.requested": {
    requestId: string;
    capability: ToolCapability;
    reason: string;
  };
  "approval.resolved": PolicyDecision;
  "provider.session": { session: AgentNativeSessionRef };
  "provider.message": { text: string; completed: boolean };
  "tool.requested": { request: ToolRequest };
  "tool.started": { requestId: string; startedAt: string };
  "tool.completed": {
    requestId: string;
    status: "completed" | "failed" | "denied" | "interrupted";
    completedAt: string;
    exitCode?: number;
    outputHash?: string;
    boundedOutput?: string;
  };
  "file.changed": {
    paths: string[];
    checkpointId?: string;
  };
  "checkpoint.created": {
    checkpointId: string;
    parentId?: string;
    label: string;
    manifestHash: string;
    changedPaths: string[];
    totalBytes: number;
  };
  "verification.completed": { receipt: VerificationReceipt };
  "repair.started": { receipt: RepairAttemptReceipt };
  "repair.completed": { receipt: RepairAttemptReceipt };
  "repair.stopped": {
    fingerprint: string;
    attempts: number;
    reason: "same-fingerprint" | "budget-exhausted" | "provider-interrupted";
    stoppedAt: string;
  };
  "analysis.updated": { receipt: AnalysisUpdateReceipt };
  "review.created": {
    reviewId: string;
    changeSetIds: string[];
    changedPaths: string[];
  };
  "run.completed": { response: string; completedAt: string };
  "run.failed": { error: string; completedAt: string };
};

export type HarnessEvent<T extends HarnessEventType = HarnessEventType> = {
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  type: T;
  payload: HarnessEventPayloads[T];
  payloadHash: string;
};

export type AnyHarnessEvent = {
  [T in HarnessEventType]: HarnessEvent<T>;
}[HarnessEventType];

export type EngineeringRunProjection = {
  contract: "witch.engineering-run/v1";
  schemaVersion: 1;
  runId: string;
  parentRunId?: string;
  workspaceRoot: string;
  workspaceName: string;
  sourceRevision: string;
  providerId: AgentProviderId;
  providerLabel: string;
  nativeSession?: AgentNativeSessionRef;
  mode: AgentMode;
  goal: string;
  state: HarnessRunState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  budget: RunBudget;
  usage: RunBudgetUsage;
  contexts: ContextSelection[];
  plan?: EngineeringPlan;
  planEvaluations: PlanEvaluation[];
  approvals: PolicyDecision[];
  tools: Array<{
    request: ToolRequest;
    status:
      | "requested"
      | "running"
      | "completed"
      | "failed"
      | "denied"
      | "interrupted";
    startedAt?: string;
    completedAt?: string;
    exitCode?: number;
    outputHash?: string;
  }>;
  verification: VerificationReceipt[];
  repairs: RepairAttemptReceipt[];
  repairStopReason?: HarnessEventPayloads["repair.stopped"]["reason"];
  analysisUpdates: AnalysisUpdateReceipt[];
  changedPaths: string[];
  checkpointIds: string[];
  reviewId?: string;
  response: string;
  error?: string;
  lastSequence: number;
  eventCount: number;
  eventDigest: string;
  appliedEvents: Record<string, string>;
  legacy?: RunCreatedPayload["legacy"];
};

export type HarnessEventDiagnostic = {
  code: string;
  message: string;
};

export type HarnessEventValidation = {
  valid: boolean;
  diagnostics: HarnessEventDiagnostic[];
};

export type LegacyAgentRunProjection = {
  events: AnyHarnessEvent[];
  run: EngineeringRunProjection;
};

export const defaultRunBudget = (mode: AgentMode): RunBudget =>
  mode === "ask"
    ? {
        wallTimeMs: 10 * 60_000,
        providerTurns: 8,
        maxChangedFiles: 0,
        maxChangedBytes: 0,
        maxProcesses: 1,
        maxRepairAttempts: 0,
        maxToolRequests: 40,
      }
    : {
        wallTimeMs: 30 * 60_000,
        providerTurns: 24,
        maxChangedFiles: 200,
        maxChangedBytes: 12 * 1024 * 1024,
        maxProcesses: 2,
        maxRepairAttempts: 2,
        maxToolRequests: 120,
      };

export const emptyRunBudgetUsage = (): RunBudgetUsage => ({
  wallTimeMs: 0,
  providerTurns: 0,
  changedFiles: 0,
  changedBytes: 0,
  processes: 0,
  repairAttempts: 0,
  toolRequests: 0,
});
