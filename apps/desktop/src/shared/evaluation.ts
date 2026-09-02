export type EvaluationFault =
  | "truncated-provider-json"
  | "tool-exit"
  | "checkpoint-failure"
  | "renderer-reload"
  | "app-quit"
  | "external-source-mutation"
  | "repeated-verification"
  | "oversized-diff"
  | "scope-symlink"
  | "stop-before-approval";

export type EvaluationProviderKind = "fake" | "live";

export type EvaluationRequest = {
  goal: string;
  mode: "ask" | "change";
};

export type EvaluationExpectedScope = {
  selectedPaths: string[];
  changedPaths: string[];
};

export type EvaluationAssertions = {
  requiredPaths: string[];
  forbiddenPaths: string[];
  expectedVerificationPassed: boolean;
};

export type EvaluationAllowedCommands = {
  commands: string[];
};

export type EvaluationProviderInput = {
  caseId: string;
  request: EvaluationRequest;
  inventory: string[];
  expectedScope: EvaluationExpectedScope;
  assertions: EvaluationAssertions;
  allowedCommands: EvaluationAllowedCommands;
};

export type EvaluationProviderOutput = {
  selectedPaths: string[];
  plannedPaths: string[];
  changedPaths: string[];
  commands: string[];
  verificationPassed: boolean;
  verificationRuns: number;
};

export type EvaluationProvider = {
  id: string;
  kind: EvaluationProviderKind;
  run(input: EvaluationProviderInput): Promise<EvaluationProviderOutput>;
};

export type EvaluationDiagnostic = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

export type EvaluationMetrics = {
  contextPrecision: number;
  contextRecall: number;
  planPrecision: number;
  planRecall: number;
  changedPathPrecision: number;
  changedPathRecall: number;
  outOfScopeChanges: number;
  forbiddenPathSelections: number;
  commandViolations: number;
  verificationAccuracy: 0 | 1;
  boundedVerification: 0 | 1;
  sourceStable: 0 | 1;
  receiptIntegrity: 0 | 1;
};

export type EvaluationResult = {
  schemaVersion: 1;
  contract: "witch.evaluation/v1";
  caseId: string;
  fixtureRevision: string;
  providerId: string;
  providerKind: EvaluationProviderKind;
  status: "passed" | "failed";
  faults: EvaluationFault[];
  output: EvaluationProviderOutput;
  metrics: EvaluationMetrics;
  diagnostics: EvaluationDiagnostic[];
  receiptHash: string;
};

export type EvaluationProviderScore = {
  providerId: string;
  cases: number;
  passed: number;
  contextF1: number;
  planF1: number;
  changedPathF1: number;
  commandViolations: number;
  outOfScopeChanges: number;
};

export type EvaluationMatrixResult = {
  contract: "witch.evaluation-matrix/v1";
  fixtureCount: number;
  providerCount: number;
  results: EvaluationResult[];
  scores: EvaluationProviderScore[];
};
