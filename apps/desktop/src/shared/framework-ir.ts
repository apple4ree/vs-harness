import type { ArchitectureNode, SourceEvidence } from "./architecture";
import type {
  FrameworkDiagnostic,
  FrameworkGraph,
  FrameworkValidationReceipt,
} from "./framework";
import type { SemanticGraph } from "./semantic";

export type FrameworkGraphDraft = Omit<FrameworkGraph, "validation">;

const evidenceKey = (evidence: SourceEvidence) =>
  `${evidence.path}:${String(evidence.line).padStart(12, "0")}:${evidence.hash}:${evidence.excerpt || ""}`;

function push(
  diagnostics: FrameworkDiagnostic[],
  code: string,
  severity: FrameworkDiagnostic["severity"],
  subject: string,
  message: string,
) {
  diagnostics.push({ code, severity, subject, message });
}

export function validateFrameworkGraph(
  graph: FrameworkGraphDraft | FrameworkGraph,
  semantic?: SemanticGraph,
  sourceNodes: ArchitectureNode[] = [],
): FrameworkValidationReceipt {
  const diagnostics = [...graph.diagnostics];
  const semanticIds = new Set(semantic?.nodes.map((node) => node.id) || []);
  const sources = new Map(
    sourceNodes
      .filter((node) => node.kind === "file" && node.path)
      .map((node) => [node.path!, node]),
  );
  const detections = new Set<string>();
  const candidates = new Set<string>();
  const relations = new Set<string>();
  let evidenceCount = 0;
  if (graph.schemaVersion !== 1 || graph.contract !== "witch.framework/v1")
    push(
      diagnostics,
      "FRAMEWORK_SCHEMA_UNSUPPORTED",
      "error",
      "document",
      "Framework analysis must use witch.framework/v1",
    );
  if (
    !graph.workspaceRoot ||
    !graph.sourceRevision ||
    !graph.semanticRevision ||
    !graph.revision
  )
    push(
      diagnostics,
      "FRAMEWORK_IDENTITY_MISSING",
      "error",
      "document",
      "Workspace, source, semantic, and framework revisions are required",
    );
  if (semantic && graph.semanticRevision !== semantic.revision)
    push(
      diagnostics,
      "FRAMEWORK_SEMANTIC_REVISION_MISMATCH",
      "error",
      "document",
      "Framework endpoints were not derived from this semantic revision",
    );
  const validateEvidence = (subject: string, evidence: SourceEvidence[]) => {
    if (!evidence.length)
      push(
        diagnostics,
        "FRAMEWORK_EVIDENCE_MISSING",
        "error",
        subject,
        "Framework facts require exact source evidence",
      );
    for (const item of evidence) {
      evidenceCount++;
      const source = sources.get(item.path);
      if (!item.path || !Number.isSafeInteger(item.line) || item.line < 1 || !item.hash)
        push(
          diagnostics,
          "FRAMEWORK_EVIDENCE_INVALID",
          "error",
          subject,
          "Evidence requires a path, positive line, and source hash",
        );
      else if (!source)
        push(
          diagnostics,
          "FRAMEWORK_EVIDENCE_SOURCE_MISSING",
          "error",
          subject,
          `Evidence source ${item.path} is outside the architecture graph`,
        );
      else if (source.hash !== item.hash)
        push(
          diagnostics,
          "FRAMEWORK_EVIDENCE_HASH_MISMATCH",
          "error",
          subject,
          `Evidence for ${item.path} is stale`,
        );
    }
  };
  for (const detection of graph.detections) {
    if (!detection.id || detections.has(detection.id))
      push(
        diagnostics,
        "FRAMEWORK_DETECTION_ID_INVALID",
        "error",
        detection.id || "detection",
        "Detection ids must be present and unique",
      );
    detections.add(detection.id);
    if (!detection.adapterId || !detection.adapterVersion)
      push(
        diagnostics,
        "FRAMEWORK_ADAPTER_IDENTITY_MISSING",
        "error",
        detection.id,
        "Detection requires a versioned adapter identity",
      );
    validateEvidence(detection.id, detection.evidence);
  }
  for (const candidate of graph.candidates) {
    if (!candidate.id || candidates.has(candidate.id))
      push(
        diagnostics,
        "FRAMEWORK_CANDIDATE_ID_INVALID",
        "error",
        candidate.id || "candidate",
        "Candidate ids must be present and unique",
      );
    candidates.add(candidate.id);
    if (!candidate.relationId || relations.has(candidate.relationId))
      push(
        diagnostics,
        "FRAMEWORK_RELATION_ID_INVALID",
        "error",
        candidate.id,
        "Candidate relation ids must be present and unique",
      );
    relations.add(candidate.relationId);
    if (!candidate.adapterId || !candidate.adapterVersion || !candidate.ruleId)
      push(
        diagnostics,
        "FRAMEWORK_RULE_PROVENANCE_MISSING",
        "error",
        candidate.id,
        "Candidate requires adapter id, adapter version, and rule id",
      );
    if (!semanticIds.has(candidate.from) || !semanticIds.has(candidate.to))
      push(
        diagnostics,
        "FRAMEWORK_ENDPOINT_MISSING",
        "error",
        candidate.id,
        "Candidate endpoints must reference existing semantic nodes",
      );
    if (!candidate.valueLabel.trim() || candidate.valueLabel.length > 300)
      push(
        diagnostics,
        "FRAMEWORK_VALUE_LABEL_INVALID",
        "error",
        candidate.id,
        "Candidate value labels must be present and bounded",
      );
    if (
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    )
      push(
        diagnostics,
        "FRAMEWORK_CONFIDENCE_INVALID",
        "error",
        candidate.id,
        "Candidate confidence must be between zero and one",
      );
    validateEvidence(candidate.id, candidate.evidence);
  }
  const excludedCount = graph.coverage.reduce(
    (total, item) => total + item.excludedCount,
    0,
  );
  diagnostics.sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) ||
      left.subject.localeCompare(right.subject) ||
      left.message.localeCompare(right.message),
  );
  return {
    contract: "witch.framework/v1",
    valid: !diagnostics.some((item) => item.severity === "error"),
    revision: graph.revision,
    detectionCount: graph.detections.length,
    candidateCount: graph.candidates.length,
    evidenceCount,
    excludedCount,
    diagnostics,
  };
}

export function finalizeFrameworkGraph(
  draft: FrameworkGraphDraft,
  semantic: SemanticGraph,
  sourceNodes: ArchitectureNode[],
): FrameworkGraph {
  const graph: FrameworkGraphDraft = {
    ...draft,
    detections: [...draft.detections]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        ...item,
        evidence: [...item.evidence].sort((left, right) =>
          evidenceKey(left).localeCompare(evidenceKey(right)),
        ),
      })),
    candidates: [...draft.candidates]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        ...item,
        evidence: [...item.evidence].sort((left, right) =>
          evidenceKey(left).localeCompare(evidenceKey(right)),
        ),
      })),
    coverage: [...draft.coverage].sort((left, right) =>
      left.framework.localeCompare(right.framework),
    ),
    diagnostics: [...draft.diagnostics].sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        left.subject.localeCompare(right.subject),
    ),
  };
  const validation = validateFrameworkGraph(graph, semantic, sourceNodes);
  if (!validation.valid) {
    const details = validation.diagnostics
      .filter((item) => item.severity === "error")
      .slice(0, 8)
      .map((item) => `${item.code} (${item.subject}): ${item.message}`)
      .join("; ");
    throw new Error(`Framework IR validation failed: ${details}`);
  }
  return { ...graph, validation };
}
