import type { BehaviorRelation } from "./behavior";

export type RuntimeTraceStatus =
  "running" | "completed" | "failed" | "interrupted";

export type RuntimeTraceEvent = {
  id: string;
  sequence: number;
  phase: "enter" | "exit" | "error";
  semanticNodeId: string;
  parentSemanticNodeId?: string;
  offsetMs: number;
  durationMs?: number;
  outcome: "unknown" | "ok" | "error";
};

export type RuntimeTraceDiagnostic = {
  code: string;
  severity: "error" | "warning";
  subject: string;
  message: string;
};

export type RuntimeTraceValidationReceipt = {
  contract: "witch.runtime-trace/v1";
  valid: boolean;
  revision: string;
  eventCount: number;
  observedRelationCount: number;
  actualValueCount: 0;
  diagnostics: RuntimeTraceDiagnostic[];
};

export type RuntimeTraceSession = {
  schemaVersion: 1;
  contract: "witch.runtime-trace/v1";
  analyzerVersion: string;
  policyVersion: string;
  id: string;
  workspaceRoot: string;
  sourceRevision: string;
  semanticRevision: string;
  taskId: string;
  taskLabel: string;
  startedAt: string;
  completedAt?: string;
  commandReceipt: string;
  status: RuntimeTraceStatus;
  revision: string;
  events: RuntimeTraceEvent[];
  warnings: RuntimeTraceDiagnostic[];
  validation: RuntimeTraceValidationReceipt;
};

export type RuntimeTraceWireEvent = {
  phase: "enter" | "exit" | "error";
  path: string;
  symbol: string;
  line?: number;
  outcome?: "ok" | "error";
};

export type RuntimeObservedRelation = BehaviorRelation & {
  trust: "observed";
  status: "accepted";
  observationCount: number;
  totalDurationMs: number;
};

export type RuntimeTraceComparison = {
  staticRelationCount: number;
  observedRelationCount: number;
  matchedCount: number;
  staticOnlyCount: number;
  observedOnlyCount: number;
  matchedStaticIds: string[];
  matchedObservedIds: string[];
};

export type RuntimeTraceMode = "static" | "observed" | "compare";
