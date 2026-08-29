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
  kind: "function" | "class" | "interface" | "type" | "variable" | "component";
  line: number;
  endLine: number;
  exported: boolean;
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
  revision: string;
};

export const COMPONENT_DRAG_TYPE = "application/x-witch-component";

export function componentContext(
  nodeId: string,
  label: string,
  paths: string[],
  revision: string,
  line?: number,
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
    ...(Number.isSafeInteger(line) && line! > 0 && line! <= 1_000_000
      ? { line }
      : {}),
  };
}
