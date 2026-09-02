import type { SourceEvidence } from "./architecture";

export type BehaviorTrust = "verified" | "inferred" | "authored" | "observed";

export type BehaviorRelationKind =
  | "calls"
  | "passes"
  | "returns"
  | "produces"
  | "consumes"
  | "reads-state"
  | "writes-state"
  | "persists"
  | "publishes"
  | "subscribes"
  | "spawns"
  | "raises"
  | "handles"
  | "routes-to";

export type BehaviorValue = {
  id: string;
  label: string;
  shape?: string;
  sensitivity?: "unknown" | "public" | "internal" | "sensitive";
  /** Existing semantic node that owns the source expression or declaration. */
  sourceNodeId: string;
};

export type BehaviorProvenance = {
  analyzer: string;
  version: string;
  policy: string;
  framework?: string;
  ruleId?: string;
  candidateId?: string;
  traceSessionId?: string;
};

export type BehaviorRelation = {
  id: string;
  from: string;
  to: string;
  kind: BehaviorRelationKind;
  valueId?: string;
  trust: BehaviorTrust;
  confidence: number;
  status: "accepted" | "provisional" | "corroborated" | "conflicting";
  evidence: SourceEvidence[];
  provenance: BehaviorProvenance;
};

export type BehaviorDiagnostic = {
  code: string;
  severity: "error" | "warning";
  subject: string;
  message: string;
};

export type BehaviorValidationReceipt = {
  contract: "witch.behavior/v1";
  valid: boolean;
  revision: string;
  valueCount: number;
  relationCount: number;
  evidenceCount: number;
  verifiedCount: number;
  inferredCount: number;
  diagnostics: BehaviorDiagnostic[];
};

export type BehaviorWorkflowSummary = {
  workflowId: string;
  inputs: string[];
  outputs: string[];
  sideEffects: string[];
  relationIds: string[];
};

export type BehaviorGraph = {
  schemaVersion: 1;
  contract: "witch.behavior/v1";
  analyzerVersion: string;
  policyVersion: string;
  workspaceRoot: string;
  sourceRevision: string;
  semanticRevision: string;
  revision: string;
  generatedAt: string;
  values: BehaviorValue[];
  relations: BehaviorRelation[];
  workflows: BehaviorWorkflowSummary[];
  validation: BehaviorValidationReceipt;
};
