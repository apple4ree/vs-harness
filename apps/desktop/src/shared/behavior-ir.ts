import type { ArchitectureNode, SourceEvidence } from "./architecture";
import type {
  BehaviorDiagnostic,
  BehaviorGraph,
  BehaviorValidationReceipt,
} from "./behavior";
import type { SemanticGraph } from "./semantic";

export type BehaviorGraphDraft = Omit<BehaviorGraph, "validation">;

const evidenceKey = (evidence: SourceEvidence) =>
  `${evidence.path}:${String(evidence.line).padStart(12, "0")}:${String(evidence.endLine || evidence.line).padStart(12, "0")}:${evidence.hash}:${evidence.excerpt || ""}`;

function diagnostic(
  diagnostics: BehaviorDiagnostic[],
  code: string,
  severity: BehaviorDiagnostic["severity"],
  subject: string,
  message: string,
) {
  diagnostics.push({ code, severity, subject, message });
}

export function validateBehaviorGraph(
  graph: BehaviorGraphDraft | BehaviorGraph,
  semantic?: SemanticGraph,
  sourceNodes: ArchitectureNode[] = [],
): BehaviorValidationReceipt {
  const diagnostics: BehaviorDiagnostic[] = [];
  const semanticIds = new Set(semantic?.nodes.map((node) => node.id) || []);
  const sources = new Map(
    sourceNodes
      .filter((node) => node.kind === "file" && node.path)
      .map((node) => [node.path!, node]),
  );
  const values = new Set<string>();
  const relations = new Set<string>();
  let evidenceCount = 0;
  let verifiedCount = 0;
  let inferredCount = 0;

  if (graph.schemaVersion !== 1 || graph.contract !== "witch.behavior/v1")
    diagnostic(
      diagnostics,
      "BEHAVIOR_SCHEMA_UNSUPPORTED",
      "error",
      "document",
      "The behavior graph must use witch.behavior/v1",
    );
  if (
    !graph.workspaceRoot ||
    !graph.sourceRevision ||
    !graph.semanticRevision ||
    !graph.revision
  )
    diagnostic(
      diagnostics,
      "BEHAVIOR_IDENTITY_MISSING",
      "error",
      "document",
      "Workspace, source, semantic, and behavior revisions are required",
    );
  if (semantic && graph.semanticRevision !== semantic.revision)
    diagnostic(
      diagnostics,
      "BEHAVIOR_SEMANTIC_REVISION_MISMATCH",
      "error",
      "document",
      "Behavior endpoints were not derived from this semantic revision",
    );

  for (const value of graph.values) {
    if (!value.id || values.has(value.id))
      diagnostic(
        diagnostics,
        value.id ? "BEHAVIOR_VALUE_DUPLICATE" : "BEHAVIOR_VALUE_ID_MISSING",
        "error",
        value.id || "value",
        "Behavior value ids must be present and unique",
      );
    values.add(value.id);
    if (!value.label.trim())
      diagnostic(
        diagnostics,
        "BEHAVIOR_VALUE_LABEL_MISSING",
        "error",
        value.id,
        "Behavior values require a bounded display label",
      );
    if (!semanticIds.has(value.sourceNodeId))
      diagnostic(
        diagnostics,
        "BEHAVIOR_VALUE_SOURCE_MISSING",
        "error",
        value.id,
        "Behavior values must cite an existing semantic source node",
      );
  }

  for (const relation of graph.relations) {
    if (!relation.id || relations.has(relation.id))
      diagnostic(
        diagnostics,
        relation.id
          ? "BEHAVIOR_RELATION_DUPLICATE"
          : "BEHAVIOR_RELATION_ID_MISSING",
        "error",
        relation.id || "relation",
        "Behavior relation ids must be present and unique",
      );
    relations.add(relation.id);
    if (!semanticIds.has(relation.from) || !semanticIds.has(relation.to))
      diagnostic(
        diagnostics,
        "BEHAVIOR_RELATION_ENDPOINT_MISSING",
        "error",
        relation.id,
        "Behavior relations must connect existing semantic nodes",
      );
    if (relation.valueId && !values.has(relation.valueId))
      diagnostic(
        diagnostics,
        "BEHAVIOR_RELATION_VALUE_MISSING",
        "error",
        relation.id,
        "Behavior relation references an unknown value",
      );
    if (!Number.isFinite(relation.confidence) || relation.confidence < 0 || relation.confidence > 1)
      diagnostic(
        diagnostics,
        "BEHAVIOR_CONFIDENCE_INVALID",
        "error",
        relation.id,
        "Confidence must be between zero and one",
      );
    if (!relation.evidence.length)
      diagnostic(
        diagnostics,
        "BEHAVIOR_EVIDENCE_MISSING",
        "error",
        relation.id,
        "Every behavior relation requires source evidence",
      );
    if (
      !relation.provenance.analyzer ||
      !relation.provenance.version ||
      !relation.provenance.policy
    )
      diagnostic(
        diagnostics,
        "BEHAVIOR_PROVENANCE_MISSING",
        "error",
        relation.id,
        "Every behavior relation requires analyzer, version, and policy provenance",
      );
    if (
      Boolean(relation.provenance.framework) !==
        Boolean(relation.provenance.ruleId) ||
      (relation.provenance.framework && !relation.provenance.candidateId)
    )
      diagnostic(
        diagnostics,
        "BEHAVIOR_FRAMEWORK_PROVENANCE_INCOMPLETE",
        "error",
        relation.id,
        "Framework behavior requires framework, rule, and candidate identities",
      );
    if (relation.trust === "observed" && !relation.provenance.traceSessionId)
      diagnostic(
        diagnostics,
        "BEHAVIOR_TRACE_SESSION_MISSING",
        "error",
        relation.id,
        "Observed behavior requires a trace session identity",
      );
    if (relation.trust === "verified" && relation.status !== "accepted")
      diagnostic(
        diagnostics,
        "BEHAVIOR_VERIFIED_STATUS_INVALID",
        "error",
        relation.id,
        "Verified behavior must remain accepted",
      );
    if (relation.trust === "inferred" && relation.status === "accepted")
      diagnostic(
        diagnostics,
        "BEHAVIOR_INFERENCE_NOT_PROVISIONAL",
        "error",
        relation.id,
        "Inferred behavior cannot silently become accepted",
      );
    if (relation.trust === "verified") verifiedCount++;
    if (relation.trust === "inferred") inferredCount++;
    for (const evidence of relation.evidence) {
      evidenceCount++;
      const source = sources.get(evidence.path);
      if (
        !evidence.path ||
        !Number.isSafeInteger(evidence.line) ||
        evidence.line < 1 ||
        !evidence.hash
      )
        diagnostic(
          diagnostics,
          "BEHAVIOR_EVIDENCE_INVALID",
          "error",
          relation.id,
          "Evidence requires a path, positive line, and content hash",
        );
      if (!source)
        diagnostic(
          diagnostics,
          "BEHAVIOR_EVIDENCE_SOURCE_MISSING",
          "error",
          relation.id,
          `Evidence source ${evidence.path} is outside the architecture graph`,
        );
      else if (source.hash !== evidence.hash)
        diagnostic(
          diagnostics,
          "BEHAVIOR_EVIDENCE_HASH_MISMATCH",
          "error",
          relation.id,
          `Evidence for ${evidence.path} is stale`,
        );
    }
  }

  for (const summary of graph.workflows) {
    if (!semanticIds.has(summary.workflowId))
      diagnostic(
        diagnostics,
        "BEHAVIOR_WORKFLOW_MISSING",
        "error",
        summary.workflowId,
        "Workflow behavior summaries must reference an existing semantic workflow",
      );
    if (summary.relationIds.some((id) => !relations.has(id)))
      diagnostic(
        diagnostics,
        "BEHAVIOR_WORKFLOW_RELATION_MISSING",
        "error",
        summary.workflowId,
        "Workflow summary references an unknown behavior relation",
      );
  }

  diagnostics.sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) ||
      left.subject.localeCompare(right.subject) ||
      left.message.localeCompare(right.message),
  );
  return {
    contract: "witch.behavior/v1",
    valid: !diagnostics.some((item) => item.severity === "error"),
    revision: graph.revision,
    valueCount: graph.values.length,
    relationCount: graph.relations.length,
    evidenceCount,
    verifiedCount,
    inferredCount,
    diagnostics,
  };
}

export function finalizeBehaviorGraph(
  draft: BehaviorGraphDraft,
  semantic: SemanticGraph,
  sourceNodes: ArchitectureNode[],
): BehaviorGraph {
  const graph: BehaviorGraphDraft = {
    ...draft,
    values: [...draft.values].sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...draft.relations]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((relation) => ({
        ...relation,
        evidence: [...relation.evidence].sort((a, b) =>
          evidenceKey(a).localeCompare(evidenceKey(b)),
        ),
      })),
    workflows: [...draft.workflows]
      .sort((a, b) => a.workflowId.localeCompare(b.workflowId))
      .map((summary) => ({
        ...summary,
        inputs: [...new Set(summary.inputs)].sort(),
        outputs: [...new Set(summary.outputs)].sort(),
        sideEffects: [...new Set(summary.sideEffects)].sort(),
        relationIds: [...new Set(summary.relationIds)].sort(),
      })),
  };
  const validation = validateBehaviorGraph(graph, semantic, sourceNodes);
  if (!validation.valid) {
    const details = validation.diagnostics
      .filter((item) => item.severity === "error")
      .slice(0, 8)
      .map((item) => `${item.code} (${item.subject}): ${item.message}`)
      .join("; ");
    throw new Error(`Behavior IR validation failed: ${details}`);
  }
  return { ...graph, validation };
}
