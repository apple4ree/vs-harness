import type {
  ArchitectureDiagnostic,
  ArchitectureGraph,
  ArchitectureValidationReceipt,
} from "./architecture";
import { finalizeSemanticGraph, validateSemanticGraph } from "./semantic-ir";
import { finalizeBehaviorGraph, validateBehaviorGraph } from "./behavior-ir";
import { finalizeFrameworkGraph, validateFrameworkGraph } from "./framework-ir";
import { finalizeKnowledgeGraph, validateKnowledgeGraph } from "./knowledge-ir";

export type ArchitectureGraphDraft = Omit<ArchitectureGraph, "validation">;

function diagnostic(
  diagnostics: ArchitectureDiagnostic[],
  code: string,
  severity: ArchitectureDiagnostic["severity"],
  subject: string,
  message: string,
) {
  diagnostics.push({ code, severity, subject, message });
}

function evidenceKey(evidence: {
  path: string;
  line: number;
  endLine?: number;
  hash: string;
  excerpt?: string;
}) {
  return `${evidence.path}:${evidence.line}:${evidence.endLine || evidence.line}:${evidence.hash}:${evidence.excerpt || ""}`;
}

/**
 * Validate authored facts only. The receipt never infers runtime behavior or
 * mutates topology, so identical IR produces an identical receipt.
 */
export function validateArchitectureGraph(
  graph: ArchitectureGraphDraft | ArchitectureGraph,
): ArchitectureValidationReceipt {
  const diagnostics: ArchitectureDiagnostic[] = [];
  const nodes = new Map<string, (typeof graph.nodes)[number]>();
  const edges = new Set<string>();
  let evidenceCount = 0;
  let sourceBackedNodes = 0;
  let sourceBackedEdges = 0;

  if (graph.schemaVersion !== 1)
    diagnostic(
      diagnostics,
      "IR_SCHEMA_UNSUPPORTED",
      "error",
      "document",
      `Unsupported architecture schema ${String(graph.schemaVersion)}`,
    );
  if (graph.diagramKind !== "architecture")
    diagnostic(
      diagnostics,
      "IR_KIND_INVALID",
      "error",
      "document",
      "The document kind must be architecture",
    );
  if (!graph.workspaceRoot)
    diagnostic(
      diagnostics,
      "IR_ROOT_MISSING",
      "error",
      "document",
      "A workspace root is required",
    );
  if (!graph.revision)
    diagnostic(
      diagnostics,
      "IR_REVISION_MISSING",
      "error",
      "document",
      "A source revision is required",
    );
  if (graph.integrity) {
    const receipt = graph.integrity;
    const metricSets = [receipt.candidate, receipt.loss, receipt.baseline].filter(
      Boolean,
    ) as NonNullable<typeof receipt.baseline>[];
    const metricsValid = metricSets.every((metrics) =>
      Object.values(metrics).every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ),
    );
    const revisionValid =
      receipt.status === "fallback"
        ? receipt.baselineRevision === graph.revision &&
          receipt.candidateRevision !== graph.revision
        : receipt.candidateRevision === graph.revision;
    if (
      receipt.contract !== "witch.analysis-integrity/v1" ||
      !(receipt.status === "accepted" || receipt.status === "fallback") ||
      ![
        "initial",
        "stable",
        "explained-shrink",
        "user-accepted",
        "unexplained-shrink",
      ].includes(receipt.decision) ||
      !receipt.candidateRevision ||
      !metricsValid ||
      !Array.isArray(receipt.missingPaths) ||
      !Array.isArray(receipt.confirmedDeletedPaths) ||
      !receipt.detectedAt ||
      !revisionValid
    )
      diagnostic(
        diagnostics,
        "IR_INTEGRITY_RECEIPT_INVALID",
        "error",
        "document",
        "Analysis integrity receipt is malformed or bound to another revision",
      );
  }

  for (const node of graph.nodes) {
    if (!node.id) {
      diagnostic(
        diagnostics,
        "IR_NODE_ID_MISSING",
        "error",
        "node",
        "Every node needs a stable id",
      );
      continue;
    }
    if (nodes.has(node.id))
      diagnostic(
        diagnostics,
        "IR_NODE_DUPLICATE",
        "error",
        node.id,
        "Node ids must be unique",
      );
    else nodes.set(node.id, node);
    if (node.kind === "file") {
      if (!node.path || !node.hash)
        diagnostic(
          diagnostics,
          "IR_NODE_SOURCE_MISSING",
          "error",
          node.id,
          "File nodes require a path and content hash",
        );
      if (!node.evidence.length)
        diagnostic(
          diagnostics,
          "IR_NODE_EVIDENCE_MISSING",
          "error",
          node.id,
          "File nodes require source evidence",
        );
    }
    const evidence = new Set<string>();
    for (const item of node.evidence) {
      evidenceCount++;
      if (
        !item.path ||
        !Number.isSafeInteger(item.line) ||
        item.line < 1 ||
        !item.hash
      )
        diagnostic(
          diagnostics,
          "IR_EVIDENCE_INVALID",
          "error",
          node.id,
          "Evidence requires a path, positive line, and content hash",
        );
      if (node.kind === "file" && node.path && item.path !== node.path)
        diagnostic(
          diagnostics,
          "IR_NODE_EVIDENCE_PATH_MISMATCH",
          "error",
          node.id,
          `Node evidence points to ${item.path}`,
        );
      if (node.kind === "file" && node.hash && item.hash !== node.hash)
        diagnostic(
          diagnostics,
          "IR_EVIDENCE_HASH_MISMATCH",
          "error",
          node.id,
          "Node evidence does not match the analyzed content hash",
        );
      const key = evidenceKey(item);
      if (evidence.has(key))
        diagnostic(
          diagnostics,
          "IR_EVIDENCE_DUPLICATE",
          "warning",
          node.id,
          "Duplicate evidence was retained",
        );
      evidence.add(key);
    }
    if (node.evidence.length) sourceBackedNodes++;
  }

  for (const edge of graph.edges) {
    if (!edge.id || edges.has(edge.id))
      diagnostic(
        diagnostics,
        edge.id ? "IR_EDGE_DUPLICATE" : "IR_EDGE_ID_MISSING",
        "error",
        edge.id || "edge",
        edge.id ? "Edge ids must be unique" : "Every edge needs a stable id",
      );
    edges.add(edge.id);
    if (!nodes.has(edge.from))
      diagnostic(
        diagnostics,
        "IR_EDGE_SOURCE_MISSING",
        "error",
        edge.id,
        `Unknown source node ${edge.from}`,
      );
    if (!nodes.has(edge.to))
      diagnostic(
        diagnostics,
        "IR_EDGE_TARGET_MISSING",
        "error",
        edge.id,
        `Unknown target node ${edge.to}`,
      );
    if (!edge.evidence.length)
      diagnostic(
        diagnostics,
        "IR_EDGE_EVIDENCE_MISSING",
        "error",
        edge.id,
        "Relations require source evidence",
      );
    for (const item of edge.evidence) {
      evidenceCount++;
      const source = nodes.get(edge.from);
      if (
        !item.path ||
        !Number.isSafeInteger(item.line) ||
        item.line < 1 ||
        !item.hash
      )
        diagnostic(
          diagnostics,
          "IR_EVIDENCE_INVALID",
          "error",
          edge.id,
          "Evidence requires a path, positive line, and content hash",
        );
      if (source?.path && item.path !== source.path)
        diagnostic(
          diagnostics,
          "IR_EDGE_EVIDENCE_SOURCE_MISMATCH",
          "error",
          edge.id,
          `Relation evidence must originate from ${source.path}`,
        );
      if (source?.hash && item.hash !== source.hash)
        diagnostic(
          diagnostics,
          "IR_EVIDENCE_HASH_MISMATCH",
          "error",
          edge.id,
          "Relation evidence does not match its source content hash",
        );
    }
    if (edge.evidence.length) sourceBackedEdges++;
  }

  if (graph.semantic) {
    if (graph.semantic.workspaceRoot !== graph.workspaceRoot)
      diagnostic(
        diagnostics,
        "IR_SEMANTIC_ROOT_MISMATCH",
        "error",
        "semantic",
        "The semantic graph belongs to a different workspace",
      );
    if (graph.semantic.sourceRevision !== graph.revision)
      diagnostic(
        diagnostics,
        "IR_SEMANTIC_REVISION_MISMATCH",
        "error",
        "semantic",
        "The semantic graph was not produced from this source revision",
      );
    const semantic = validateSemanticGraph(graph.semantic, graph.nodes);
    for (const item of semantic.diagnostics)
      diagnostic(
        diagnostics,
        `IR_${item.code}`,
        item.severity,
        `semantic:${item.subject}`,
        item.message,
      );
  }
  if (graph.behavior) {
    if (!graph.semantic)
      diagnostic(
        diagnostics,
        "IR_BEHAVIOR_SEMANTIC_MISSING",
        "error",
        "behavior",
        "The behavior overlay requires a semantic graph",
      );
    if (graph.behavior.workspaceRoot !== graph.workspaceRoot)
      diagnostic(
        diagnostics,
        "IR_BEHAVIOR_ROOT_MISMATCH",
        "error",
        "behavior",
        "The behavior overlay belongs to a different workspace",
      );
    if (graph.behavior.sourceRevision !== graph.revision)
      diagnostic(
        diagnostics,
        "IR_BEHAVIOR_REVISION_MISMATCH",
        "error",
        "behavior",
        "The behavior overlay was not produced from this source revision",
      );
    const behavior = validateBehaviorGraph(
      graph.behavior,
      graph.semantic,
      graph.nodes,
    );
    for (const item of behavior.diagnostics)
      diagnostic(
        diagnostics,
        `IR_${item.code}`,
        item.severity,
        `behavior:${item.subject}`,
        item.message,
      );
  }
  if (graph.frameworks) {
    if (!graph.semantic)
      diagnostic(
        diagnostics,
        "IR_FRAMEWORK_SEMANTIC_MISSING",
        "error",
        "framework",
        "Framework analysis requires a semantic graph",
      );
    if (!graph.behavior)
      diagnostic(
        diagnostics,
        "IR_FRAMEWORK_BEHAVIOR_MISSING",
        "error",
        "framework",
        "Framework candidates require a behavior overlay",
      );
    if (graph.frameworks.workspaceRoot !== graph.workspaceRoot)
      diagnostic(
        diagnostics,
        "IR_FRAMEWORK_ROOT_MISMATCH",
        "error",
        "framework",
        "Framework analysis belongs to a different workspace",
      );
    if (graph.frameworks.sourceRevision !== graph.revision)
      diagnostic(
        diagnostics,
        "IR_FRAMEWORK_REVISION_MISMATCH",
        "error",
        "framework",
        "Framework analysis was not produced from this source revision",
      );
    const framework = validateFrameworkGraph(
      graph.frameworks,
      graph.semantic,
      graph.nodes,
    );
    for (const item of framework.diagnostics)
      diagnostic(
        diagnostics,
        `IR_${item.code}`,
        item.severity,
        `framework:${item.subject}`,
        item.message,
      );
    const behaviorRelations = new Map(
      graph.behavior?.relations.map((relation) => [relation.id, relation]) || [],
    );
    for (const candidate of graph.frameworks.candidates) {
      const relation = behaviorRelations.get(candidate.relationId);
      if (!relation)
        diagnostic(
          diagnostics,
          "IR_FRAMEWORK_RELATION_MISSING",
          "error",
          candidate.id,
          "Validated framework candidate is missing from the behavior overlay",
        );
      else if (
        relation.provenance.framework !== candidate.framework ||
        relation.provenance.ruleId !== candidate.ruleId ||
        relation.provenance.candidateId !== candidate.id
      )
        diagnostic(
          diagnostics,
          "IR_FRAMEWORK_RELATION_PROVENANCE_MISMATCH",
          "error",
          candidate.id,
          "Framework behavior provenance does not match its source candidate",
        );
    }
  }
  if (graph.knowledge) {
    if (graph.knowledge.workspaceRoot !== graph.workspaceRoot)
      diagnostic(
        diagnostics,
        "IR_KNOWLEDGE_ROOT_MISMATCH",
        "error",
        "knowledge",
        "Architecture knowledge belongs to a different workspace",
      );
    if (graph.knowledge.sourceRevision !== graph.revision)
      diagnostic(
        diagnostics,
        "IR_KNOWLEDGE_REVISION_MISMATCH",
        "error",
        "knowledge",
        "Architecture knowledge was not produced from this source revision",
      );
    const knowledge = validateKnowledgeGraph(
      graph.knowledge,
      graph.nodes,
      graph.semantic,
    );
    for (const item of knowledge.diagnostics)
      diagnostic(
        diagnostics,
        `IR_${item.code}`,
        item.severity,
        `knowledge:${item.subject}`,
        item.message,
      );
  }

  diagnostics.sort(
    (a, b) =>
      a.severity.localeCompare(b.severity) ||
      a.code.localeCompare(b.code) ||
      a.subject.localeCompare(b.subject) ||
      a.message.localeCompare(b.message),
  );
  return {
    contract: "witch.architecture/v1",
    valid: !diagnostics.some((item) => item.severity === "error"),
    revision: graph.revision,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    evidenceCount,
    sourceBackedNodes,
    sourceBackedEdges,
    diagnostics,
  };
}

/** Canonicalize collection order and attach the validation receipt atomically. */
export function finalizeArchitectureGraph(
  draft: ArchitectureGraphDraft,
): ArchitectureGraph {
  const graph: ArchitectureGraphDraft = {
    ...draft,
    nodes: [...draft.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => ({
        ...node,
        symbols: [...node.symbols].sort(
          (a, b) => a.line - b.line || a.id.localeCompare(b.id),
        ),
        evidence: [...node.evidence].sort((a, b) =>
          evidenceKey(a).localeCompare(evidenceKey(b)),
        ),
      })),
    edges: [...draft.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((edge) => ({
        ...edge,
        evidence: [...edge.evidence].sort((a, b) =>
          evidenceKey(a).localeCompare(evidenceKey(b)),
        ),
      })),
    warnings: [...new Set(draft.warnings)].sort((a, b) => a.localeCompare(b)),
  };
  if (graph.semantic) {
    const { validation: _validation, ...semanticDraft } = graph.semantic;
    graph.semantic = finalizeSemanticGraph(semanticDraft, graph.nodes);
  }
  if (graph.behavior && graph.semantic) {
    const { validation: _validation, ...behaviorDraft } = graph.behavior;
    graph.behavior = finalizeBehaviorGraph(
      behaviorDraft,
      graph.semantic,
      graph.nodes,
    );
  }
  if (graph.frameworks && graph.semantic) {
    const { validation: _validation, ...frameworkDraft } = graph.frameworks;
    graph.frameworks = finalizeFrameworkGraph(
      frameworkDraft,
      graph.semantic,
      graph.nodes,
    );
  }
  if (graph.knowledge) {
    const { validation: _validation, ...knowledgeDraft } = graph.knowledge;
    graph.knowledge = finalizeKnowledgeGraph(
      knowledgeDraft,
      graph.nodes,
      graph.semantic,
    );
  }
  const validation = validateArchitectureGraph(graph);
  if (!validation.valid) {
    const details = validation.diagnostics
      .filter((item) => item.severity === "error")
      .slice(0, 8)
      .map((item) => `${item.code} (${item.subject}): ${item.message}`)
      .join("; ");
    throw new Error(`Architecture IR validation failed: ${details}`);
  }
  return { ...graph, validation };
}
