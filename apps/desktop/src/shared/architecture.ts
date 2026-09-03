import type {
  SemanticGraph,
  SemanticNodeKind,
  SemanticStatus,
  SemanticTrust,
} from "./semantic";
import type { SemanticCompositionReceipt } from "./semantic-composer";
import type { BehaviorGraph } from "./behavior";
import type { FrameworkGraph } from "./framework";
import type { KnowledgeGraph } from "./knowledge";

export type SourceEvidence = {
  path: string;
  line: number;
  endLine?: number;
  hash: string;
  excerpt?: string;
};

export type CodeSymbol = {
  id: string;
  name: string;
  kind:
    | "function"
    | "method"
    | "class"
    | "interface"
    | "type"
    | "variable"
    | "component"
    | "struct"
    | "enum"
    | "trait"
    | "implementation"
    | "module";
  line: number;
  endLine: number;
  /** One-based source column when the parser can provide an exact declaration. */
  column?: number;
  /** Zero-based character offset used to bind calls to the exact AST declaration. */
  startOffset?: number;
  exported: boolean;
  qualifiedName?: string;
  containerId?: string;
  async?: boolean;
  decorators?: string[];
  signature?: string;
  visibility?: "public" | "private" | "protected" | "internal";
};

export type ArchitectureNode = {
  id: string;
  label: string;
  kind: "file" | "external";
  path?: string;
  module: string;
  language: string;
  count: number;
  hash: string;
  symbols: CodeSymbol[];
  evidence: SourceEvidence[];
};

export type ArchitectureEdge = {
  id: string;
  from: string;
  to: string;
  kind: "imports" | "exports";
  count: number;
  evidence: SourceEvidence[];
};

export type ArchitectureDiagnostic = {
  code: string;
  severity: "error" | "warning";
  subject: string;
  message: string;
};

/** Deterministic receipt for the source-grounded IR consumed by every viewer. */
export type ArchitectureValidationReceipt = {
  contract: "witch.architecture/v1";
  valid: boolean;
  revision: string;
  nodeCount: number;
  edgeCount: number;
  evidenceCount: number;
  sourceBackedNodes: number;
  sourceBackedEdges: number;
  diagnostics: ArchitectureDiagnostic[];
};

export type AnalysisLanguageCoverage = {
  /** Stable display id rather than a raw extension (for example, typescript). */
  language: string;
  extensions: string[];
  indexedFiles: number;
  analyzedFiles: number;
  deepFiles: number;
  fileOnlyFiles: number;
  skippedFiles: number;
  mode: "deep" | "partial" | "file-only";
};

export type AnalysisLimit = {
  code:
    | "file-index"
    | "byte-budget"
    | "typescript-calls"
    | "symbol-calls"
    | "symbol-relations"
    | "workflow-count"
    | "workflow-support"
    | "workflow-participants"
    | "framework-candidates"
    | "lsp-sample";
  message: string;
  reached: boolean;
};

/** Honest coverage and incremental-index telemetry for this exact reading. */
export type AnalysisCoverage = {
  totalFiles: number;
  indexedFiles: number;
  analyzedFiles: number;
  deepFiles: number;
  fileOnlyFiles: number;
  skippedFiles: number;
  skippedOversizedFiles: number;
  analyzedBytes: number;
  byteBudget: number;
  cache: {
    memoryHits: number;
    persistentHits: number;
    misses: number;
  };
  languages: AnalysisLanguageCoverage[];
  limits: AnalysisLimit[];
};

export type AnalysisGraphMetrics = {
  files: number;
  nodes: number;
  symbols: number;
  relations: number;
  semanticNodes: number;
  workflows: number;
  knowledgeNodes: number;
};

/**
 * Source-grounded admission receipt for a newly analyzed graph. A fallback
 * reading keeps the accepted graph visible while describing the quarantined
 * candidate; it never pretends that the old revision is current.
 */
export type AnalysisIntegrityReceipt = {
  contract: "witch.analysis-integrity/v1";
  status: "accepted" | "fallback";
  decision:
    | "initial"
    | "stable"
    | "explained-shrink"
    | "user-accepted"
    | "unexplained-shrink";
  baselineRevision: string | null;
  candidateRevision: string;
  baseline: AnalysisGraphMetrics | null;
  candidate: AnalysisGraphMetrics;
  loss: AnalysisGraphMetrics;
  missingPaths: string[];
  confirmedDeletedPaths: string[];
  detectedAt: string;
};

export type ArchitectureGraph = {
  schemaVersion: 1;
  diagramKind: "architecture";
  analyzerVersion: string;
  workspaceRoot: string;
  revision: string;
  generatedAt: string;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  scannedFiles: number;
  totalFiles: number;
  truncated: boolean;
  warnings: string[];
  /** Added after v1 launch; optional so immutable legacy readings remain valid. */
  coverage?: AnalysisCoverage;
  /** Optional, separately validated meaning layer. Old source-only snapshots remain valid. */
  semantic?: SemanticGraph;
  /** Optional behavior/data-flow overlay; it references semantic node IDs. */
  behavior?: BehaviorGraph;
  /** Optional source-only framework adapter findings and coverage receipt. */
  frameworks?: FrameworkGraph;
  /** Optional authored/verified architecture knowledge overlay. */
  knowledge?: KnowledgeGraph;
  /** Audited Semantic Composer run. The composed nodes live in `semantic`. */
  composition?: SemanticCompositionReceipt;
  /** Admission state for persistent last-known-good graph protection. */
  integrity?: AnalysisIntegrityReceipt;
  validation: ArchitectureValidationReceipt;
};

export type ComponentContext = {
  nodeId: string;
  label: string;
  paths: string[];
  /** Preview paths are bounded; a module nodeId still selects the entire module. */
  totalPaths?: number;
  symbol?: string;
  line?: number;
  /** Meaning contexts keep their trust boundary visible in Agent history/UI. */
  semantic?: {
    kind: SemanticNodeKind;
    trust: SemanticTrust;
    status: SemanticStatus;
    confidence: number;
  };
  revision: string;
};

export const COMPONENT_DRAG_TYPE = "application/x-witch-component";

export function componentContext(
  nodeId: string,
  label: string,
  paths: string[],
  revision: string,
  line?: number,
  semantic?: ComponentContext["semantic"],
): ComponentContext {
  const preview: string[] = [];
  let characters = 0;
  for (const file of paths) {
    if (preview.length >= 80 || characters + file.length > 24_000) break;
    preview.push(file);
    characters += file.length;
  }
  return {
    nodeId,
    label,
    paths: preview,
    totalPaths: paths.length,
    revision,
    ...(semantic ? { semantic } : {}),
    ...(Number.isSafeInteger(line) && line! > 0 && line! <= 1_000_000
      ? { line }
      : {}),
  };
}
