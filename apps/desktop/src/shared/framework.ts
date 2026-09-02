import type { SourceEvidence } from "./architecture";
import type { BehaviorRelationKind } from "./behavior";

export type FrameworkId =
  | "fastapi"
  | "langgraph"
  | "celery"
  | "express"
  | "nestjs"
  | "nextjs"
  | "axum"
  | "tokio";

export type FrameworkLanguage =
  | "python"
  | "typescript"
  | "javascript"
  | "rust";

export type FrameworkDetection = {
  id: string;
  framework: FrameworkId;
  adapterId: string;
  adapterVersion: string;
  language: FrameworkLanguage;
  path: string;
  evidence: SourceEvidence[];
};

export type FrameworkCandidate = {
  id: string;
  relationId: string;
  framework: FrameworkId;
  adapterId: string;
  adapterVersion: string;
  ruleId: string;
  language: FrameworkLanguage;
  kind: Extract<
    BehaviorRelationKind,
    "handles" | "routes-to" | "publishes" | "subscribes" | "spawns"
  >;
  from: string;
  to: string;
  valueLabel: string;
  trust: "verified" | "inferred";
  confidence: number;
  evidence: SourceEvidence[];
};

export type FrameworkDiagnostic = {
  code: string;
  severity: "error" | "warning";
  framework?: FrameworkId;
  subject: string;
  message: string;
  evidence?: SourceEvidence[];
};

export type FrameworkCoverage = {
  framework: FrameworkId;
  detectedFiles: number;
  analyzedFiles: number;
  candidateCount: number;
  excludedCount: number;
  limitReached: boolean;
};

export type FrameworkValidationReceipt = {
  contract: "witch.framework/v1";
  valid: boolean;
  revision: string;
  detectionCount: number;
  candidateCount: number;
  evidenceCount: number;
  excludedCount: number;
  diagnostics: FrameworkDiagnostic[];
};

export type FrameworkGraph = {
  schemaVersion: 1;
  contract: "witch.framework/v1";
  analyzerVersion: string;
  policyVersion: string;
  workspaceRoot: string;
  sourceRevision: string;
  semanticRevision: string;
  revision: string;
  generatedAt: string;
  detections: FrameworkDetection[];
  candidates: FrameworkCandidate[];
  coverage: FrameworkCoverage[];
  diagnostics: FrameworkDiagnostic[];
  validation: FrameworkValidationReceipt;
};
