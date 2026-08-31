import type { SourceEvidence } from "./architecture";

export type SemanticLanguage =
  "python" | "rust" | "typescript" | "javascript" | "mixed" | "unknown";

export type SemanticTrust = "verified" | "inferred" | "authored";
export type SemanticStatus =
  "accepted" | "provisional" | "corroborated" | "conflicting" | "stale";

export type SemanticNodeKind =
  | "system"
  | "workflow"
  | "workflow-step"
  | "component"
  | "package"
  | "module"
  | "file"
  | "symbol"
  | "artifact"
  | "external-system"
  | "open-question";

export type SemanticRelationKind =
  | "contains"
  | "defines"
  | "imports"
  | "exports"
  | "calls"
  | "reads"
  | "writes"
  | "emits"
  | "subscribes"
  | "routes-to"
  | "executes"
  | "precedes"
  | "branches-to"
  | "retries"
  | "depends-on"
  | "extends"
  | "implements"
  | "guards"
  | "observes";

export type WorkflowStepKind =
  | "trigger"
  | "ingest"
  | "validate"
  | "transform"
  | "infer"
  | "plan"
  | "decide"
  | "guard"
  | "tool-call"
  | "execute"
  | "persist"
  | "publish"
  | "observe"
  | "retry"
  | "compensate"
  | "cancel";

export type SemanticProvenance = {
  source: "static-analysis" | "heuristic" | "language-server" | "authored";
  analyzer: string;
  policy: string;
  model?: string;
};

export type SemanticNode = {
  id: string;
  label: string;
  kind: SemanticNodeKind;
  trust: SemanticTrust;
  status: SemanticStatus;
  confidence: number;
  language?: SemanticLanguage;
  path?: string;
  sourceNodeId?: string;
  sourceSymbolId?: string;
  stepKind?: WorkflowStepKind;
  description?: string;
  evidence: SourceEvidence[];
  provenance: SemanticProvenance;
};

export type SemanticRelation = {
  id: string;
  from: string;
  to: string;
  kind: SemanticRelationKind;
  trust: SemanticTrust;
  status: SemanticStatus;
  confidence: number;
  description?: string;
  evidence: SourceEvidence[];
  provenance: SemanticProvenance;
};

export type SemanticClaim = {
  id: string;
  subjectId: string;
  key: "boundary" | "responsibility" | "workflow" | "behavior";
  value: string;
  trust: SemanticTrust;
  status: SemanticStatus;
  confidence: number;
  reason: string;
  evidence: SourceEvidence[];
  provenance: SemanticProvenance;
};

export type SemanticOpenQuestion = {
  id: string;
  subjectId: string;
  claimIds: string[];
  relationIds?: string[];
  prompt: string;
  recommendation: string;
  options: string[];
  status: "open" | "answered" | "dismissed";
  evidence: SourceEvidence[];
};

export type SemanticRevisionSummary = {
  nodesAdded: number;
  nodesChanged: number;
  nodesRemoved: number;
  relationsAdded: number;
  relationsChanged: number;
  relationsRemoved: number;
  claimsAdded: number;
  claimsChanged: number;
  claimsRemoved: number;
  questionsOpened: number;
};

export type SemanticRevision = {
  id: string;
  parentRevision?: string;
  sourceRevision: string;
  createdAt: string;
  analyzerVersion?: string;
  policyVersion: string;
  approval: "provisional-inference";
  changedIds: string[];
  summary: SemanticRevisionSummary;
};

export type SemanticDiagnostic = {
  code: string;
  severity: "error" | "warning";
  subject: string;
  message: string;
};

export type SemanticValidationReceipt = {
  contract: "witch.semantic/v1";
  valid: boolean;
  revision: string;
  nodeCount: number;
  relationCount: number;
  claimCount: number;
  questionCount: number;
  verifiedCount: number;
  provisionalCount: number;
  evidenceCount: number;
  diagnostics: SemanticDiagnostic[];
};

export type SemanticGraph = {
  schemaVersion: 1;
  contract: "witch.semantic/v1";
  analyzerVersion: string;
  policyVersion: string;
  workspaceRoot: string;
  sourceRevision: string;
  revision: string;
  generatedAt: string;
  nodes: SemanticNode[];
  relations: SemanticRelation[];
  claims: SemanticClaim[];
  questions: SemanticOpenQuestion[];
  revisions: SemanticRevision[];
  validation: SemanticValidationReceipt;
};

export type AuthoredSemanticDocument = {
  schemaVersion: 1;
  claims: Array<{
    subjectId: string;
    key: SemanticClaim["key"];
    value: string;
    reason?: string;
  }>;
};
