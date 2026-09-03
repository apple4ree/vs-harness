import type {
  AnalysisGraphMetrics,
  AnalysisIntegrityReceipt,
  ArchitectureGraph,
} from "./architecture";

const EMPTY_METRICS: AnalysisGraphMetrics = {
  files: 0,
  nodes: 0,
  symbols: 0,
  relations: 0,
  semanticNodes: 0,
  workflows: 0,
  knowledgeNodes: 0,
};

export function architectureMetrics(
  graph: ArchitectureGraph,
): AnalysisGraphMetrics {
  return {
    files: graph.nodes.filter((node) => node.kind === "file").length,
    nodes: graph.nodes.length,
    symbols: graph.nodes.reduce(
      (total, node) => total + node.symbols.length,
      0,
    ),
    relations:
      graph.edges.length +
      (graph.semantic?.relations.length || 0) +
      (graph.behavior?.relations.length || 0) +
      (graph.knowledge?.relations.length || 0),
    semanticNodes: graph.semantic?.nodes.length || 0,
    workflows:
      graph.semantic?.nodes.filter((node) => node.kind === "workflow").length ||
      0,
    knowledgeNodes: graph.knowledge?.nodes.length || 0,
  };
}

function metricLoss(
  baseline: AnalysisGraphMetrics,
  candidate: AnalysisGraphMetrics,
): AnalysisGraphMetrics {
  return {
    files: Math.max(0, baseline.files - candidate.files),
    nodes: Math.max(0, baseline.nodes - candidate.nodes),
    symbols: Math.max(0, baseline.symbols - candidate.symbols),
    relations: Math.max(0, baseline.relations - candidate.relations),
    semanticNodes: Math.max(
      0,
      baseline.semanticNodes - candidate.semanticNodes,
    ),
    workflows: Math.max(0, baseline.workflows - candidate.workflows),
    knowledgeNodes: Math.max(
      0,
      baseline.knowledgeNodes - candidate.knowledgeNodes,
    ),
  };
}

function severeLoss(
  value: number,
  loss: number,
  minimum: number,
  ratio: number,
) {
  return value >= minimum && loss >= minimum && loss / value >= ratio;
}

function filePaths(graph: ArchitectureGraph) {
  return new Set(
    graph.nodes
      .filter((node) => node.kind === "file" && node.path)
      .map((node) => node.path!),
  );
}

export function evaluateArchitectureCandidate(
  baseline: ArchitectureGraph | null,
  candidate: ArchitectureGraph,
  confirmedDeletedPaths: ReadonlySet<string> = new Set(),
  detectedAt = new Date().toISOString(),
): AnalysisIntegrityReceipt {
  const candidateMetrics = architectureMetrics(candidate);
  if (!baseline) {
    return {
      contract: "witch.analysis-integrity/v1",
      status: "accepted",
      decision: "initial",
      baselineRevision: null,
      candidateRevision: candidate.revision,
      baseline: null,
      candidate: candidateMetrics,
      loss: { ...EMPTY_METRICS },
      missingPaths: [],
      confirmedDeletedPaths: [],
      detectedAt,
    };
  }

  const baselineMetrics = architectureMetrics(baseline);
  const loss = metricLoss(baselineMetrics, candidateMetrics);
  const candidatePaths = filePaths(candidate);
  const missingPaths = [...filePaths(baseline)]
    .filter((path) => !candidatePaths.has(path))
    .sort();
  const deleted = missingPaths.filter((path) =>
    confirmedDeletedPaths.has(path),
  );
  const unexplainedMissing = missingPaths.length - deleted.length;

  // Thresholds deliberately require both meaningful absolute loss and ratio.
  // Small repositories and ordinary one-file edits must never trip the guard.
  const severeFileLoss = severeLoss(
    baselineMetrics.files,
    loss.files,
    10,
    0.35,
  );
  const severeNodeLoss = severeLoss(baselineMetrics.nodes, loss.nodes, 15, 0.4);
  const severeSymbolLoss = severeLoss(
    baselineMetrics.symbols,
    loss.symbols,
    30,
    0.5,
  );
  const severeRelationLoss = severeLoss(
    baselineMetrics.relations,
    loss.relations,
    20,
    0.6,
  );
  const severeSemanticLoss = severeLoss(
    baselineMetrics.semanticNodes,
    loss.semanticNodes,
    12,
    0.5,
  );
  const severeWorkflowLoss = severeLoss(
    baselineMetrics.workflows,
    loss.workflows,
    8,
    0.6,
  );
  const severeKnowledgeLoss = severeLoss(
    baselineMetrics.knowledgeNodes,
    loss.knowledgeNodes,
    12,
    0.5,
  );
  const severe =
    severeFileLoss ||
    severeNodeLoss ||
    severeSymbolLoss ||
    severeRelationLoss ||
    severeSemanticLoss ||
    severeWorkflowLoss ||
    severeKnowledgeLoss;

  // A mass source deletion or branch change is explainable only when every
  // disappeared source path is actually absent on disk. Parser-only collapse
  // (symbols/relations vanish while files remain) is always quarantined.
  const sourceDeletionExplainsLoss =
    missingPaths.length > 0 &&
    unexplainedMissing === 0 &&
    (severeFileLoss || severeNodeLoss);
  const status =
    severe && !sourceDeletionExplainsLoss ? "fallback" : "accepted";
  return {
    contract: "witch.analysis-integrity/v1",
    status,
    decision:
      status === "fallback"
        ? "unexplained-shrink"
        : severe
          ? "explained-shrink"
          : "stable",
    baselineRevision: baseline.revision,
    candidateRevision: candidate.revision,
    baseline: baselineMetrics,
    candidate: candidateMetrics,
    loss,
    missingPaths: missingPaths.slice(0, 40),
    confirmedDeletedPaths: deleted.slice(0, 40),
    detectedAt,
  };
}

export function acceptedByUserReceipt(
  receipt: AnalysisIntegrityReceipt,
  detectedAt = new Date().toISOString(),
): AnalysisIntegrityReceipt {
  return {
    ...receipt,
    status: "accepted",
    decision: "user-accepted",
    detectedAt,
  };
}
