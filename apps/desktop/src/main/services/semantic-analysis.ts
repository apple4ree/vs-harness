import path from "node:path";
import type {
  ArchitectureEdge,
  ArchitectureNode,
  CodeSymbol,
  SourceEvidence,
} from "../../shared/architecture";
import type {
  AuthoredSemanticDocument,
  SemanticClaim,
  SemanticGraph,
  SemanticLanguage,
  SemanticNode,
  SemanticOpenQuestion,
  SemanticProvenance,
  SemanticRelation,
  SemanticRevisionSummary,
  WorkflowStepKind,
} from "../../shared/semantic";
import {
  finalizeSemanticGraph,
  reconcileSemanticClaims,
} from "../../shared/semantic-ir";
import { contentHash } from "./workspace-files";

export const SEMANTIC_ANALYZER_VERSION = "semantic-static-v3";
export const SEMANTIC_POLICY_VERSION = "agent-finance-v1";

export type ResolvedSymbolCall = {
  fromSourceSymbolId: string;
  toSourceSymbolId: string;
  evidence: SourceEvidence[];
  trust?: "verified" | "inferred";
  confidence?: number;
  resolver?: "typescript" | "python-static" | "rust-static";
  sites?: ResolvedCallSite[];
};

export type ResolvedCallControl = {
  id: string;
  kind: "branch" | "retry";
  label: string;
  evidence: SourceEvidence;
  arm?: string;
  maxAttempts?: number;
};

export type ResolvedCallSite = {
  evidence: SourceEvidence;
  ordinal: number;
  branch?: ResolvedCallControl;
  retry?: ResolvedCallControl;
};

const staticProvenance: SemanticProvenance = {
  source: "static-analysis",
  analyzer: SEMANTIC_ANALYZER_VERSION,
  policy: SEMANTIC_POLICY_VERSION,
};
const inferredProvenance: SemanticProvenance = {
  source: "heuristic",
  analyzer: SEMANTIC_ANALYZER_VERSION,
  policy: SEMANTIC_POLICY_VERSION,
};

function languageFor(extension: string): SemanticLanguage | null {
  if (extension === "py") return "python";
  if (extension === "rs") return "rust";
  if (["ts", "tsx", "mts", "cts"].includes(extension)) return "typescript";
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) return "javascript";
  return null;
}

const sourceEvidence = (node: ArchitectureNode): SourceEvidence[] =>
  node.path && node.hash ? [{ path: node.path, line: 1, hash: node.hash }] : [];

const symbolEvidence = (
  node: ArchitectureNode,
  symbol: CodeSymbol,
): SourceEvidence[] =>
  node.path && node.hash
    ? [
        {
          path: node.path,
          line: symbol.line,
          endLine: symbol.endLine,
          hash: node.hash,
          excerpt: symbol.signature,
        },
      ]
    : [];

function responsibilityFor(module: string) {
  const normalized = module.toLowerCase();
  if (/agent|orchestrat|planner|reason/.test(normalized))
    return "Likely coordinates agent planning, reasoning, and tool execution.";
  if (/risk|limit|compliance|guard/.test(normalized))
    return "Likely evaluates risk, limits, policy, or execution guards.";
  if (/trade|order|execution|broker|exchange/.test(normalized))
    return "Likely coordinates trading, order routing, or execution adapters.";
  if (/market|feed|quote|data|ingest/.test(normalized))
    return "Likely ingests, normalizes, or distributes market and reference data.";
  if (/portfolio|position|account|ledger/.test(normalized))
    return "Likely manages portfolio, position, account, or ledger state.";
  if (/renderer|component|view|ui|web/.test(normalized))
    return "Likely presents application state and user interactions.";
  if (/api|server|service|main|core/.test(normalized))
    return "Likely coordinates application services and external entry points.";
  return `Groups source files under the inferred ${module} module boundary.`;
}

function workflowStepFor(symbol: CodeSymbol): WorkflowStepKind | null {
  if (!["function", "method", "component"].includes(symbol.kind)) return null;
  const nameTokens = new Set(
    symbol.name
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const contextTokens = new Set(
    (symbol.qualifiedName || symbol.name)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const annotations = (symbol.decorators || []).join(" ").toLowerCase();
  const has = (...values: string[]) =>
    values.some((value) => nameTokens.has(value));
  const registered =
    /tokio::main|__main__|route|router|endpoint|command|scheduler|cron|task/.test(
      annotations,
    );
  const domain = [
    "agent",
    "workflow",
    "trade",
    "trading",
    "order",
    "risk",
    "strategy",
    "rebalance",
    "portfolio",
    "broker",
    "market",
  ].some((value) => contextTokens.has(value));
  const rootEntry =
    !symbol.containerId && has("main", "bootstrap", "start", "run");
  const utility = has(
    "get",
    "set",
    "is",
    "has",
    "ensure",
    "find",
    "load",
    "save",
    "store",
    "persist",
    "write",
    "publish",
    "emit",
    "send",
    "receive",
  );
  if (!registered && !rootEntry && (!domain || utility)) return null;
  if (registered || has("main", "bootstrap", "start")) return "trigger";
  if (has("ingest", "consume", "receive", "fetch", "load")) return "ingest";
  if (has("validate", "check", "verify")) return "validate";
  if (has("infer", "predict", "model")) return "infer";
  if (has("plan", "reason", "agent")) return "plan";
  if (has("risk", "decide", "select", "strategy", "rebalance")) return "decide";
  if (has("guard", "authorize", "approve", "limit")) return "guard";
  if (has("tool", "invoke") || /\btool\b/.test(annotations)) return "tool-call";
  if (has("submit", "trade", "order", "execute", "handle", "process", "run"))
    return "execute";
  if (has("save", "store", "persist", "commit", "write")) return "persist";
  if (has("publish", "emit", "send")) return "publish";
  if (has("monitor", "observe", "watch", "health")) return "observe";
  if (has("retry")) return "retry";
  if (has("cancel")) return "cancel";
  return null;
}

function semanticFingerprint(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as any).evidence)
  ) {
    const item = value as { evidence: SourceEvidence[] } & Record<
      string,
      unknown
    >;
    value = {
      ...item,
      evidence: [...item.evidence].sort((a, b) =>
        `${a.path}:${String(a.line).padStart(12, "0")}:${String(a.endLine || a.line).padStart(12, "0")}:${a.hash}:${a.excerpt || ""}`.localeCompare(
          `${b.path}:${String(b.line).padStart(12, "0")}:${String(b.endLine || b.line).padStart(12, "0")}:${b.hash}:${b.excerpt || ""}`,
        ),
      ),
    };
  }
  return contentHash(JSON.stringify(value));
}

function compareItems<T extends { id: string }>(previous: T[], next: T[]) {
  const before = new Map(
    previous.map((item) => [item.id, semanticFingerprint(item)]),
  );
  const after = new Map(
    next.map((item) => [item.id, semanticFingerprint(item)]),
  );
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const changed = [...after.keys()].filter(
    (id) => before.has(id) && before.get(id) !== after.get(id),
  );
  return { added, removed, changed };
}

function revisionSummary(
  previous: SemanticGraph | null | undefined,
  nodes: SemanticNode[],
  relations: SemanticRelation[],
  claims: SemanticClaim[],
  questions: SemanticOpenQuestion[],
) {
  const nodeDelta = compareItems(previous?.nodes || [], nodes);
  const relationDelta = compareItems(previous?.relations || [], relations);
  const claimDelta = compareItems(previous?.claims || [], claims);
  const previousQuestions = new Set(
    (previous?.questions || [])
      .filter((question) => question.status === "open")
      .map((question) => question.id),
  );
  const questionsOpened = questions.filter(
    (question) =>
      question.status === "open" && !previousQuestions.has(question.id),
  ).length;
  const summary: SemanticRevisionSummary = {
    nodesAdded: nodeDelta.added.length,
    nodesChanged: nodeDelta.changed.length,
    nodesRemoved: nodeDelta.removed.length,
    relationsAdded: relationDelta.added.length,
    relationsChanged: relationDelta.changed.length,
    relationsRemoved: relationDelta.removed.length,
    claimsAdded: claimDelta.added.length,
    claimsChanged: claimDelta.changed.length,
    claimsRemoved: claimDelta.removed.length,
    questionsOpened,
  };
  return {
    summary,
    changedIds: [
      ...nodeDelta.added,
      ...nodeDelta.changed,
      ...nodeDelta.removed,
      ...relationDelta.added,
      ...relationDelta.changed,
      ...relationDelta.removed,
      ...claimDelta.added,
      ...claimDelta.changed,
      ...claimDelta.removed,
    ],
  };
}

function parseAuthoredDocument(
  content: string | null | undefined,
): AuthoredSemanticDocument | null {
  if (!content) return null;
  const value: unknown = JSON.parse(content);
  if (
    !value ||
    typeof value !== "object" ||
    (value as any).schemaVersion !== 1 ||
    !Array.isArray((value as any).claims) ||
    (value as any).claims.length > 500 ||
    (value as any).claims.some(
      (claim: any) =>
        !claim ||
        typeof claim.subjectId !== "string" ||
        !["boundary", "responsibility", "workflow", "behavior"].includes(
          claim.key,
        ) ||
        typeof claim.value !== "string" ||
        claim.value.length > 4_000 ||
        (claim.reason !== undefined && typeof claim.reason !== "string"),
    )
  )
    throw new Error(".witch/analysis.json does not match schema version 1");
  return value as AuthoredSemanticDocument;
}

export function buildSemanticGraph({
  workspaceRoot,
  sourceRevision,
  generatedAt,
  nodes: architectureNodes,
  edges: architectureEdges,
  previous,
  authoredContent,
  symbolCalls = [],
}: {
  workspaceRoot: string;
  sourceRevision: string;
  generatedAt: string;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  previous?: SemanticGraph | null;
  authoredContent?: string | null;
  symbolCalls?: ResolvedSymbolCall[];
}): { graph: SemanticGraph; warnings: string[] } {
  const warnings: string[] = [];
  const nodes: SemanticNode[] = [];
  const relations: SemanticRelation[] = [];
  const inferredClaims: SemanticClaim[] = [];
  const systemId = "semantic:system:workspace";
  const sourceFiles = architectureNodes.filter(
    (node) => node.kind === "file" && Boolean(languageFor(node.language)),
  );
  nodes.push({
    id: systemId,
    label: path.basename(workspaceRoot),
    kind: "system",
    trust: "inferred",
    status: "provisional",
    confidence: 0.99,
    language: "mixed",
    description: "Workspace treated as the analysis system boundary.",
    evidence: sourceFiles[0] ? sourceEvidence(sourceFiles[0]) : [],
    provenance: inferredProvenance,
  });

  const semanticFiles = new Map<string, string>();
  const semanticSymbols = new Map<string, string>();
  const components = new Map<string, string>();
  for (const source of sourceFiles) {
    const language = languageFor(source.language)!;
    const componentId = `semantic:component:${source.module}`;
    const fileId = `semantic:file:${source.id}`;
    semanticFiles.set(source.id, fileId);
    if (!components.has(source.module)) {
      components.set(source.module, componentId);
      const evidence = sourceEvidence(source);
      const responsibility = responsibilityFor(source.module);
      nodes.push({
        id: componentId,
        label: source.module,
        kind: "component",
        trust: "inferred",
        status: "provisional",
        confidence: 0.72,
        language,
        sourceNodeId: source.id,
        description: responsibility,
        evidence,
        provenance: inferredProvenance,
      });
      relations.push({
        id: `semantic:contains:${systemId}:${componentId}`,
        from: systemId,
        to: componentId,
        kind: "contains",
        trust: "inferred",
        status: "provisional",
        confidence: 0.72,
        evidence,
        provenance: inferredProvenance,
      });
      inferredClaims.push(
        {
          id: `semantic:claim:${componentId}:boundary`,
          subjectId: componentId,
          key: "boundary",
          value: `The ${source.module} source module is treated as one component boundary.`,
          trust: "inferred",
          status: "provisional",
          confidence: 0.72,
          reason: "The boundary follows the repository module grouping rule.",
          evidence,
          provenance: inferredProvenance,
        },
        {
          id: `semantic:claim:${componentId}:responsibility`,
          subjectId: componentId,
          key: "responsibility",
          value: responsibility,
          trust: "inferred",
          status: "provisional",
          confidence: responsibility.startsWith("Groups") ? 0.55 : 0.68,
          reason:
            "Responsibility was inferred from module naming and supported file placement.",
          evidence,
          provenance: inferredProvenance,
        },
      );
    }
    nodes.push({
      id: fileId,
      label: source.label,
      kind: "file",
      trust: "verified",
      status: "accepted",
      confidence: 1,
      language,
      path: source.path,
      sourceNodeId: source.id,
      evidence: sourceEvidence(source),
      provenance: staticProvenance,
    });
    relations.push({
      id: `semantic:contains:${componentId}:${fileId}`,
      from: componentId,
      to: fileId,
      kind: "contains",
      trust: "inferred",
      status: "provisional",
      confidence: 0.72,
      evidence: sourceEvidence(source),
      provenance: inferredProvenance,
    });
    for (const symbol of source.symbols) {
      const symbolId = `semantic:symbol:${symbol.id}`;
      semanticSymbols.set(symbol.id, symbolId);
      nodes.push({
        id: symbolId,
        label: symbol.qualifiedName || symbol.name,
        kind: "symbol",
        trust: "verified",
        status: "accepted",
        confidence: 1,
        language,
        path: source.path,
        sourceNodeId: source.id,
        sourceSymbolId: symbol.id,
        description: `${symbol.kind}${symbol.async ? " · async" : ""}`,
        evidence: symbolEvidence(source, symbol),
        provenance: staticProvenance,
      });
      relations.push({
        id: `semantic:defines:${fileId}:${symbolId}`,
        from: fileId,
        to: symbolId,
        kind: "defines",
        trust: "verified",
        status: "accepted",
        confidence: 1,
        evidence: symbolEvidence(source, symbol),
        provenance: staticProvenance,
      });
    }
  }

  for (const source of sourceFiles)
    for (const symbol of source.symbols) {
      const child = semanticSymbols.get(symbol.id);
      const parent = symbol.containerId
        ? semanticSymbols.get(symbol.containerId)
        : null;
      if (!child || !parent) continue;
      relations.push({
        id: `semantic:contains:${parent}:${child}`,
        from: parent,
        to: child,
        kind: "contains",
        trust: "verified",
        status: "accepted",
        confidence: 1,
        evidence: symbolEvidence(source, symbol),
        provenance: staticProvenance,
      });
    }

  for (const call of symbolCalls) {
    const from = semanticSymbols.get(call.fromSourceSymbolId);
    const to = semanticSymbols.get(call.toSourceSymbolId);
    if (!from || !to || !call.evidence.length) continue;
    const trust = call.trust || "verified";
    relations.push({
      id: `semantic:calls:${from}:${to}`,
      from,
      to,
      kind: "calls",
      trust,
      status: trust === "verified" ? "accepted" : "provisional",
      confidence: call.confidence ?? (trust === "verified" ? 1 : 0.85),
      description:
        call.resolver === "python-static"
          ? "Python static binding candidate; runtime rebinding and monkey-patching are not proven."
          : call.resolver === "rust-static"
            ? "Rust source-resolved call candidate; compiler call hierarchy can further corroborate it."
            : "TypeScript compiler-resolved direct identifier call.",
      evidence: call.evidence,
      provenance: trust === "verified" ? staticProvenance : inferredProvenance,
    });
  }

  const externalNodes = new Set<string>();
  for (const edge of architectureEdges) {
    const from = semanticFiles.get(edge.from);
    if (!from) continue;
    let to = semanticFiles.get(edge.to);
    if (!to && edge.to.startsWith("external:")) {
      to = `semantic:external:${edge.to.slice(9)}`;
      if (!externalNodes.has(to)) {
        externalNodes.add(to);
        nodes.push({
          id: to,
          label: edge.to.slice(9),
          kind: "external-system",
          trust: "verified",
          status: "accepted",
          confidence: 1,
          language: "unknown",
          sourceNodeId: edge.to,
          evidence: edge.evidence,
          provenance: staticProvenance,
        });
      }
    }
    if (!to) continue;
    relations.push({
      id: `semantic:${edge.kind}:${from}:${to}`,
      from,
      to,
      kind: edge.kind,
      trust: "verified",
      status: "accepted",
      confidence: 1,
      evidence: edge.evidence,
      provenance: staticProvenance,
    });
  }

  const sourceSymbols = new Map(
    sourceFiles.flatMap((source) =>
      source.symbols.map((symbol) => [symbol.id, { source, symbol }] as const),
    ),
  );
  const callsBySource = new Map<string, ResolvedSymbolCall[]>();
  for (const call of symbolCalls) {
    const existing = callsBySource.get(call.fromSourceSymbolId);
    if (existing) existing.push(call);
    else callsBySource.set(call.fromSourceSymbolId, [call]);
  }
  let workflowCount = 0;
  let workflowParticipantCount = 0;
  for (const source of sourceFiles) {
    for (const symbol of source.symbols) {
      if (workflowCount >= 100) break;
      const stepKind = workflowStepFor(symbol);
      const symbolId = semanticSymbols.get(symbol.id);
      if (!stepKind || !symbolId) continue;
      workflowCount++;
      const workflowId = `semantic:workflow:${symbol.id}`;
      const stepId = `${workflowId}:step`;
      const evidence = symbolEvidence(source, symbol);
      nodes.push(
        {
          id: workflowId,
          label: `${symbol.name} workflow`,
          kind: "workflow",
          trust: "inferred",
          status: "provisional",
          confidence: 0.64,
          language: languageFor(source.language)!,
          path: source.path,
          sourceNodeId: source.id,
          sourceSymbolId: symbol.id,
          description: `Candidate workflow anchored at ${symbol.qualifiedName || symbol.name}.`,
          evidence,
          provenance: inferredProvenance,
        },
        {
          id: stepId,
          label: symbol.name,
          kind: "workflow-step",
          stepKind,
          trust: "inferred",
          status: "provisional",
          confidence: 0.64,
          language: languageFor(source.language)!,
          path: source.path,
          sourceNodeId: source.id,
          sourceSymbolId: symbol.id,
          description: `Provisional ${stepKind} step inferred from the symbol name and annotations.`,
          evidence,
          provenance: inferredProvenance,
        },
      );
      relations.push(
        {
          id: `semantic:contains:${systemId}:${workflowId}`,
          from: systemId,
          to: workflowId,
          kind: "contains",
          trust: "inferred",
          status: "provisional",
          confidence: 0.64,
          evidence,
          provenance: inferredProvenance,
        },
        {
          id: `semantic:contains:${workflowId}:${stepId}`,
          from: workflowId,
          to: stepId,
          kind: "contains",
          trust: "inferred",
          status: "provisional",
          confidence: 0.64,
          evidence,
          provenance: inferredProvenance,
        },
        {
          id: `semantic:executes:${stepId}:${symbolId}`,
          from: stepId,
          to: symbolId,
          kind: "executes",
          trust: "inferred",
          status: "provisional",
          confidence: 0.64,
          evidence,
          provenance: inferredProvenance,
        },
      );
      inferredClaims.push({
        id: `semantic:claim:${workflowId}:workflow`,
        subjectId: workflowId,
        key: "workflow",
        value: `${symbol.qualifiedName || symbol.name} is treated as a ${stepKind} workflow entry point.`,
        trust: "inferred",
        status: "provisional",
        confidence: 0.64,
        reason:
          "The symbol name or annotation matches the active agent/finance workflow policy.",
        evidence,
        provenance: inferredProvenance,
      });
      const participants = (callsBySource.get(symbol.id) || [])
        .filter((call) => call.toSourceSymbolId !== symbol.id)
        .flatMap((call) =>
          (call.sites?.length
            ? call.sites
            : call.evidence.map((item, index): ResolvedCallSite => ({
                evidence: item,
                ordinal: item.line * 10_000 + index,
              }))
          ).map((site) => ({ call, site })),
        )
        .sort(
          (a, b) =>
            a.site.ordinal - b.site.ordinal ||
            a.call.toSourceSymbolId.localeCompare(b.call.toSourceSymbolId),
        )
        .slice(0, Math.max(0, Math.min(16, 800 - workflowParticipantCount)));
      const participantRecords: Array<{
        id: string;
        call: ResolvedSymbolCall;
        site: ResolvedCallSite;
      }> = [];
      const controlNodes = new Map<string, string>();
      const relationIds = new Set(relations.map((relation) => relation.id));
      const addFlowRelation = (
        from: string,
        to: string,
        kind: "precedes" | "branches-to" | "retries",
        confidence: number,
        relationEvidence: SourceEvidence[],
        description: string,
      ) => {
        const id = `semantic:${kind}:${workflowId}:${contentHash(`${from}:${to}:${kind}`).slice(0, 16)}`;
        if (from === to || relationIds.has(id)) return;
        relationIds.add(id);
        relations.push({
          id,
          from,
          to,
          kind,
          trust: "inferred",
          status: "provisional",
          confidence,
          description,
          evidence: [
            ...new Map(
              relationEvidence.map((item) => [
                `${item.path}:${item.line}:${item.excerpt || ""}`,
                item,
              ]),
            ).values(),
          ].slice(0, 4),
          provenance: inferredProvenance,
        });
      };
      const ensureControl = (control: ResolvedCallControl) => {
        const existing = controlNodes.get(control.id);
        if (existing) return existing;
        const id = `${workflowId}:control:${contentHash(control.id).slice(0, 12)}`;
        controlNodes.set(control.id, id);
        const controlSource = sourceFiles.find(
          (candidate) => candidate.id === control.evidence.path,
        );
        nodes.push({
          id,
          label: control.label,
          kind: "workflow-step",
          stepKind: control.kind === "branch" ? "guard" : "retry",
          trust: "inferred",
          status: "provisional",
          confidence: control.kind === "branch" ? 0.88 : 0.9,
          language: controlSource
            ? languageFor(controlSource.language) || undefined
            : undefined,
          path: control.evidence.path,
          description:
            control.kind === "branch"
              ? "Source control condition. Branch membership is statically inferred; runtime choice is not observed."
              : `${control.maxAttempts ? `Bounded retry controller with up to ${control.maxAttempts} attempts.` : "Explicit retry-like loop or decorator; the runtime attempt count is not proven."}`,
          evidence: [control.evidence],
          provenance: inferredProvenance,
        });
        relations.push({
          id: `semantic:contains:${workflowId}:${id}`,
          from: workflowId,
          to: id,
          kind: "contains",
          trust: "inferred",
          status: "provisional",
          confidence: control.kind === "branch" ? 0.88 : 0.9,
          evidence: [control.evidence],
          provenance: inferredProvenance,
        });
        return id;
      };
      for (const { call, site } of participants) {
        const target = sourceSymbols.get(call.toSourceSymbolId);
        const targetId = semanticSymbols.get(call.toSourceSymbolId);
        if (!target || !targetId) continue;
        workflowParticipantCount++;
        const participantId = `${workflowId}:participant:${contentHash(`${call.toSourceSymbolId}:${site.evidence.path}:${site.ordinal}`).slice(0, 16)}`;
        const participantKind = workflowStepFor(target.symbol) || "execute";
        const confidence = Math.min(
          call.confidence ?? (call.trust === "verified" ? 1 : 0.82),
          site.branch || site.retry ? 0.86 : 0.82,
        );
        nodes.push({
          id: participantId,
          label: target.symbol.qualifiedName || target.symbol.name,
          kind: "workflow-step",
          stepKind: participantKind,
          trust: "inferred",
          status: "provisional",
          confidence,
          language: languageFor(target.source.language)!,
          path: target.source.path,
          sourceNodeId: target.source.id,
          sourceSymbolId: target.symbol.id,
          description:
            call.resolver === "typescript" && !site.branch && !site.retry
              ? "Direct compiler-resolved call participant; branch and runtime order are not asserted."
              : `${call.resolver === "python-static" ? "Python" : call.resolver === "rust-static" ? "Rust" : "Static"} call participant${site.branch ? ` in ${site.branch.arm || site.branch.label}` : ""}${site.retry ? " under an explicit retry controller" : ""}. Runtime execution remains provisional.`,
          evidence: [site.evidence],
          provenance: inferredProvenance,
        });
        relations.push(
          {
            id: `semantic:contains:${workflowId}:${participantId}`,
            from: workflowId,
            to: participantId,
            kind: "contains",
            trust: "inferred",
            status: "provisional",
            confidence,
            evidence: [site.evidence],
            provenance: inferredProvenance,
          },
          {
            id: `semantic:executes:${participantId}:${targetId}`,
            from: participantId,
            to: targetId,
            kind: "executes",
            trust: "inferred",
            status: "provisional",
            confidence,
            evidence: [site.evidence],
            provenance: inferredProvenance,
          },
        );
        participantRecords.push({ id: participantId, call, site });
        if (site.branch) ensureControl(site.branch);
        if (site.retry) ensureControl(site.retry);
      }
      const entryFor = (record: (typeof participantRecords)[number]) =>
        record.site.retry
          ? ensureControl(record.site.retry)
          : record.site.branch
            ? ensureControl(record.site.branch)
            : record.id;
      if (participantRecords[0])
        addFlowRelation(
          stepId,
          entryFor(participantRecords[0]),
          "precedes",
          0.78,
          [...evidence, participantRecords[0].site.evidence],
          "The inferred workflow entry reaches the first statically visible call/control site.",
        );
      const branchGroups = new Map<
        string,
        Map<string, typeof participantRecords>
      >();
      const retryGroups = new Map<string, typeof participantRecords>();
      for (const record of participantRecords) {
        if (record.site.branch) {
          const arms = branchGroups.get(record.site.branch.id) || new Map();
          const arm = record.site.branch.arm || record.site.branch.label;
          arms.set(arm, [...(arms.get(arm) || []), record]);
          branchGroups.set(record.site.branch.id, arms);
        }
        if (record.site.retry)
          retryGroups.set(record.site.retry.id, [
            ...(retryGroups.get(record.site.retry.id) || []),
            record,
          ]);
      }
      for (const arms of branchGroups.values()) {
        for (const records of arms.values()) {
          const first = records[0];
          const branch = first.site.branch!;
          addFlowRelation(
            ensureControl(branch),
            first.id,
            "branches-to",
            0.88,
            [branch.evidence, first.site.evidence],
            `The call is lexically contained in branch arm ${branch.arm || branch.label}; the runtime branch choice is not observed.`,
          );
          for (let index = 1; index < records.length; index++)
            addFlowRelation(
              records[index - 1].id,
              records[index].id,
              "precedes",
              0.8,
              [records[index - 1].site.evidence, records[index].site.evidence],
              "Lexical order within the same branch arm; exceptions and early exits can alter runtime execution.",
            );
        }
      }
      for (const records of retryGroups.values()) {
        const first = records[0];
        const retry = first.site.retry!;
        addFlowRelation(
          ensureControl(retry),
          first.site.branch ? ensureControl(first.site.branch) : first.id,
          "retries",
          retry.maxAttempts ? 0.92 : 0.86,
          [retry.evidence, first.site.evidence],
          retry.maxAttempts
            ? `The source loop can repeat this body up to ${retry.maxAttempts} attempts.`
            : "The explicit retry-like controller may repeat this body; the number of attempts is not statically bounded.",
        );
        for (let index = 1; index < records.length; index++)
          if (
            records[index - 1].site.branch?.id ===
              records[index].site.branch?.id &&
            records[index - 1].site.branch?.arm ===
              records[index].site.branch?.arm
          )
            addFlowRelation(
              records[index - 1].id,
              records[index].id,
              "precedes",
              0.78,
              [records[index - 1].site.evidence, records[index].site.evidence],
              "Lexical order inside the same retry body; runtime completion is not observed.",
            );
      }
      for (let index = 1; index < participantRecords.length; index++) {
        const previousRecord = participantRecords[index - 1];
        const currentRecord = participantRecords[index];
        const sameBranch =
          previousRecord.site.branch?.id === currentRecord.site.branch?.id &&
          previousRecord.site.branch?.arm === currentRecord.site.branch?.arm;
        const sameRetry =
          previousRecord.site.retry?.id === currentRecord.site.retry?.id;
        if (
          !previousRecord.site.branch &&
          !currentRecord.site.branch &&
          sameRetry
        )
          addFlowRelation(
            previousRecord.id,
            currentRecord.id,
            "precedes",
            0.8,
            [previousRecord.site.evidence, currentRecord.site.evidence],
            "Straight-line lexical order; exceptions, returns, and runtime dispatch can alter execution.",
          );
        else if (sameBranch && sameRetry)
          addFlowRelation(
            previousRecord.id,
            currentRecord.id,
            "precedes",
            0.8,
            [previousRecord.site.evidence, currentRecord.site.evidence],
            "Lexical order within the same control-flow arm; runtime execution is not observed.",
          );
        else if (
          !previousRecord.site.branch &&
          !previousRecord.site.retry &&
          (currentRecord.site.branch || currentRecord.site.retry)
        )
          addFlowRelation(
            previousRecord.id,
            entryFor(currentRecord),
            "precedes",
            0.78,
            [previousRecord.site.evidence, currentRecord.site.evidence],
            "Lexical transition into a branch or retry controller.",
          );
      }
      for (const arms of branchGroups.values()) {
        const all = [...arms.values()].flat();
        const end = Math.max(...all.map((record) => record.site.ordinal));
        const next = participantRecords.find(
          (record) =>
            record.site.ordinal > end &&
            record.site.branch?.id !== all[0].site.branch?.id,
        );
        if (!next) continue;
        for (const records of arms.values()) {
          const last = records.at(-1)!;
          addFlowRelation(
            last.id,
            entryFor(next),
            "precedes",
            0.72,
            [last.site.evidence, next.site.evidence],
            "Possible branch convergence in lexical control flow; early return or exception can bypass it.",
          );
        }
      }
      for (const records of retryGroups.values()) {
        const last = records.at(-1)!;
        const next = participantRecords.find(
          (record) =>
            record.site.ordinal > last.site.ordinal &&
            record.site.retry?.id !== last.site.retry?.id,
        );
        if (next)
          addFlowRelation(
            last.id,
            entryFor(next),
            "precedes",
            0.7,
            [last.site.evidence, next.site.evidence],
            "Possible continuation after the retry controller succeeds or exits.",
          );
      }
    }
  }

  let authoredDocument: AuthoredSemanticDocument | null = null;
  try {
    authoredDocument = parseAuthoredDocument(authoredContent);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  const authoredNode = architectureNodes.find(
    (node) => node.path === ".witch/analysis.json",
  );
  const knownNodes = new Set(nodes.map((node) => node.id));
  const aliases = new Map<string, string>();
  for (const [module, id] of components)
    aliases.set(module, id).set(`component:${module}`, id);
  for (const [source, id] of semanticFiles)
    aliases.set(source, id).set(`file:${source}`, id);
  for (const [source, id] of semanticSymbols)
    aliases.set(source, id).set(`symbol:${source}`, id);
  const authoredClaims: SemanticClaim[] = [];
  for (const [index, claim] of (authoredDocument?.claims || []).entries()) {
    const subjectId = knownNodes.has(claim.subjectId)
      ? claim.subjectId
      : aliases.get(claim.subjectId);
    if (!subjectId) {
      warnings.push(
        `.witch/analysis.json claim ${index + 1} references unknown subject ${claim.subjectId}`,
      );
      continue;
    }
    authoredClaims.push({
      id: `semantic:authored:${contentHash(`${subjectId}:${claim.key}:${claim.value}`)}`,
      subjectId,
      key: claim.key,
      value: claim.value,
      trust: "authored",
      status: "accepted",
      confidence: 1,
      reason: claim.reason || "Authored in .witch/analysis.json.",
      evidence: authoredNode ? sourceEvidence(authoredNode) : [],
      provenance: {
        source: "authored",
        analyzer: SEMANTIC_ANALYZER_VERSION,
        policy: SEMANTIC_POLICY_VERSION,
      },
    });
  }
  const reconciled = reconcileSemanticClaims(inferredClaims, authoredClaims);
  const claims = reconciled.claims;
  const questions = reconciled.questions;
  const core = {
    analyzerVersion: SEMANTIC_ANALYZER_VERSION,
    policyVersion: SEMANTIC_POLICY_VERSION,
    sourceRevision,
    nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
    relations: [...relations].sort((a, b) => a.id.localeCompare(b.id)),
    claims: [...claims].sort((a, b) => a.id.localeCompare(b.id)),
    questions: [...questions].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const revision = semanticFingerprint(core);
  const compatiblePrevious =
    previous?.workspaceRoot === workspaceRoot ? previous : null;
  const delta = revisionSummary(
    compatiblePrevious,
    nodes,
    relations,
    claims,
    questions,
  );
  const unchanged =
    compatiblePrevious?.revision === revision &&
    Object.values(delta.summary).every((value) => value === 0);
  const revisions = unchanged
    ? compatiblePrevious.revisions
    : [
        ...(compatiblePrevious?.revisions || []),
        {
          id: revision,
          ...(compatiblePrevious?.revision
            ? { parentRevision: compatiblePrevious.revision }
            : {}),
          sourceRevision,
          createdAt: generatedAt,
          analyzerVersion: SEMANTIC_ANALYZER_VERSION,
          policyVersion: SEMANTIC_POLICY_VERSION,
          approval: "provisional-inference" as const,
          changedIds: delta.changedIds,
          summary: delta.summary,
        },
      ];
  return {
    graph: finalizeSemanticGraph(
      {
        schemaVersion: 1,
        contract: "witch.semantic/v1",
        analyzerVersion: SEMANTIC_ANALYZER_VERSION,
        policyVersion: SEMANTIC_POLICY_VERSION,
        workspaceRoot,
        sourceRevision,
        revision,
        generatedAt,
        nodes,
        relations,
        claims,
        questions,
        revisions,
      },
      architectureNodes,
    ),
    warnings,
  };
}
