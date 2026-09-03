import type { SourceEvidence } from "./architecture";

export type KnowledgeNodeKind =
  | "decision"
  | "rfc"
  | "manifest"
  | "package"
  | "dependency"
  | "configuration"
  | "federation-repository"
  | "federation-mapping";

export type KnowledgeRelationKind =
  | "documented-in"
  | "declared-in"
  | "depends-on"
  | "configures"
  | "documents"
  | "describes"
  | "supersedes"
  | "evidenced-by";

export type KnowledgeTrust = "verified" | "authored" | "inferred";
export type KnowledgeStatus = "accepted" | "provisional" | "superseded";

export type KnowledgeProvenance = {
  source: "manifest" | "configuration" | "architecture-document";
  extractor: string;
  ruleId: string;
};

export type KnowledgeNode = {
  id: string;
  label: string;
  kind: KnowledgeNodeKind;
  trust: KnowledgeTrust;
  status: KnowledgeStatus;
  confidence: number;
  path?: string;
  ecosystem?: "npm" | "python" | "cargo";
  /** Stable authored identity from .witch/federation.json. */
  repositoryKey?: string;
  /** Stable authored provider identity for a federation mapping. */
  providerRepositoryKey?: string;
  description?: string;
  rationale?: {
    context?: string;
    decision?: string;
    consequences?: string;
  };
  evidence: SourceEvidence[];
  provenance: KnowledgeProvenance;
};

export type KnowledgeRelation = {
  id: string;
  from: string;
  to: string;
  kind: KnowledgeRelationKind;
  trust: KnowledgeTrust;
  status: KnowledgeStatus;
  confidence: number;
  description?: string;
  evidence: SourceEvidence[];
  provenance: KnowledgeProvenance;
};

export type KnowledgeDiagnostic = {
  code: string;
  severity: "error" | "warning";
  subject: string;
  message: string;
};

export type KnowledgeValidationReceipt = {
  contract: "witch.knowledge/v1";
  valid: boolean;
  revision: string;
  nodeCount: number;
  relationCount: number;
  decisionCount: number;
  packageCount: number;
  configurationCount: number;
  evidenceCount: number;
  diagnostics: KnowledgeDiagnostic[];
};

export type KnowledgeGraph = {
  schemaVersion: 1;
  contract: "witch.knowledge/v1";
  analyzerVersion: string;
  policyVersion: string;
  workspaceRoot: string;
  sourceRevision: string;
  semanticRevision?: string;
  revision: string;
  generatedAt: string;
  nodes: KnowledgeNode[];
  relations: KnowledgeRelation[];
  diagnostics: KnowledgeDiagnostic[];
  validation: KnowledgeValidationReceipt;
};
