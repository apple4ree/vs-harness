import type {
  ArchitectureNode,
  CodeSymbol,
  SourceEvidence,
} from "../../shared/architecture";
import type {
  BehaviorGraph,
  BehaviorRelation,
  BehaviorRelationKind,
  BehaviorTrust,
  BehaviorValue,
} from "../../shared/behavior";
import { finalizeBehaviorGraph } from "../../shared/behavior-ir";
import type { SemanticGraph, SemanticNode } from "../../shared/semantic";
import type { FrameworkCandidate } from "../../shared/framework";
import type {
  ResolvedSymbolCall,
  ResolvedSymbolRelation,
} from "./semantic-analysis";
import { contentHash } from "./workspace-files";

export const BEHAVIOR_ANALYZER_VERSION = "behavior-static-v1";
export const BEHAVIOR_POLICY_VERSION = "direct-binding-evidence-v1";
const MAX_RELATIONS = 20_000;

type Language = "typescript" | "javascript" | "python" | "rust";
type SymbolRecord = {
  node: ArchitectureNode;
  symbol: CodeSymbol;
  semanticId: string;
  language: Language;
};

function languageFor(node: ArchitectureNode): Language | null {
  if (["ts", "tsx", "mts", "cts"].includes(node.language))
    return "typescript";
  if (["js", "jsx", "mjs", "cjs"].includes(node.language))
    return "javascript";
  if (node.language === "py") return "python";
  if (node.language === "rs") return "rust";
  return null;
}

function splitTopLevel(value: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (["(", "[", "{"].includes(character)) depth++;
    else if ([")", "]", "}"].includes(character)) depth--;
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) return null;
  }
  if (quote || depth !== 0) return null;
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function parenthesizedAfter(text: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\b${escaped}\\s*\\(`).exec(text);
  if (!match) return null;
  const open = text.indexOf("(", match.index);
  let depth = 0;
  let quote = "";
  let escapedCharacter = false;
  for (let index = open; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (escapedCharacter) escapedCharacter = false;
      else if (character === "\\") escapedCharacter = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) quote = character;
    else if (character === "(") depth++;
    else if (character === ")" && --depth === 0)
      return text.slice(open + 1, index);
  }
  return null;
}

function parameterName(parameter: string, language: Language) {
  const value = parameter.trim();
  if (!value) return null;
  if (
    value.includes("...") ||
    (language === "python" && value.includes("*")) ||
    (language === "rust" && /(?:^|[&\s])(?:mut\s+)?self(?:\s|$|:)/.test(value))
  )
    return null;
  if (language === "rust")
    return value.match(/^(?:mut\s+)?([A-Za-z_]\w*)\s*:/)?.[1] || null;
  return (
    value
      .replace(/^(?:public|private|protected|readonly)\s+/, "")
      .match(/^([A-Za-z_]\w*)\??(?:\s*[:=]|$)/)?.[1] || null
  );
}

function parameters(record: SymbolRecord) {
  const signature = record.symbol.signature || "";
  const raw = parenthesizedAfter(signature, record.symbol.name);
  if (raw === null) return null;
  const parts = splitTopLevel(raw);
  if (!parts) return null;
  const names = parts.map((part) => parameterName(part, record.language));
  return names.some((name) => !name) ? null : (names as string[]);
}

function safeArgument(expression: string, language: Language) {
  const value = expression.trim();
  if (!value || value.length > 240) return false;
  if (value.includes("...") || (language === "python" && /^\*{1,2}/.test(value)))
    return false;
  // Nested calls, lambdas, collections with unpacking, and Rust macros stay
  // outside this first static binding contract.
  if (/\b[A-Za-z_]\w*\s*[!(]\s*[^)]/.test(value)) return false;
  if (/=>|\blambda\b|\bawait\b/.test(value)) return false;
  return true;
}

function bindArguments(
  caller: SymbolRecord,
  callee: SymbolRecord,
  evidence: SourceEvidence,
) {
  const names = parameters(callee);
  const raw = parenthesizedAfter(evidence.excerpt || "", callee.symbol.name);
  const parts = raw === null ? null : splitTopLevel(raw);
  if (!names || !parts || parts.some((part) => !safeArgument(part, caller.language)))
    return null;
  if (caller.language === "python") {
    const bound = new Map<string, string>();
    let positional = 0;
    let keywordSeen = false;
    for (const part of parts) {
      const keyword = part.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
      if (keyword) {
        keywordSeen = true;
        if (!names.includes(keyword[1]) || bound.has(keyword[1])) return null;
        bound.set(keyword[1], keyword[2].trim());
      } else {
        if (keywordSeen || positional >= names.length) return null;
        bound.set(names[positional++], part);
      }
    }
    return [...bound].map(([parameter, argument]) => ({ parameter, argument }));
  }
  if (parts.length !== names.length) return null;
  return names.map((parameter, index) => ({
    parameter,
    argument: parts[index],
  }));
}

function targetReturnsValue(record: SymbolRecord, contents: Map<string, string>) {
  const content = contents.get(record.node.id);
  if (!content) return false;
  const lines = content.split(/\r?\n/).slice(
    Math.max(0, record.symbol.line - 1),
    record.symbol.endLine,
  );
  return /=>\s*(?!\{)/.test(lines[0] || "") || lines.some((line) => /\breturn\s+[^;\s}]/.test(line));
}

function callResultLabel(evidence: SourceEvidence) {
  const excerpt = evidence.excerpt || "";
  const assignment = excerpt.match(
    /(?:\b(?:const|let|var)\s+)?([A-Za-z_]\w*)\s*=\s*[^=]/,
  );
  if (assignment) return assignment[1];
  if (/\breturn\s+/.test(excerpt)) return "caller return";
  return null;
}

function sideEffectLabel(kind: BehaviorRelationKind, target: SymbolRecord) {
  if (kind === "reads-state") return `reads ${target.symbol.name}`;
  if (kind === "writes-state") return `writes ${target.symbol.name}`;
  return `${kind} ${target.symbol.name}`;
}

export function buildBehaviorGraph(input: {
  workspaceRoot: string;
  sourceRevision: string;
  generatedAt: string;
  nodes: ArchitectureNode[];
  semantic: SemanticGraph;
  contents: Map<string, string>;
  symbolCalls: ResolvedSymbolCall[];
  symbolRelations: ResolvedSymbolRelation[];
  frameworkCandidates?: FrameworkCandidate[];
}): BehaviorGraph {
  const semanticSymbols = new Map(
    input.semantic.nodes
      .filter((node) => node.kind === "symbol" && node.sourceSymbolId)
      .map((node) => [node.sourceSymbolId!, node.id]),
  );
  const records = new Map<string, SymbolRecord>();
  for (const node of input.nodes) {
    const language = languageFor(node);
    if (!language) continue;
    for (const symbol of node.symbols) {
      const semanticId = semanticSymbols.get(symbol.id);
      if (semanticId)
        records.set(symbol.id, { node, symbol, semanticId, language });
    }
  }
  const values = new Map<string, BehaviorValue>();
  const relations = new Map<string, BehaviorRelation>();
  const add = (
    relation: BehaviorRelation,
    value?: BehaviorValue,
  ) => {
    if (relations.size >= MAX_RELATIONS || relations.has(relation.id)) return;
    if (value) values.set(value.id, value);
    relations.set(relation.id, relation);
  };
  const provenance = (analyzer: string) => ({
    analyzer,
    version: BEHAVIOR_ANALYZER_VERSION,
    policy: BEHAVIOR_POLICY_VERSION,
  });

  // Framework facts are inserted before the generic relation budget so an
  // explicit route/task rule is never hidden by a very large call graph.
  for (const candidate of input.frameworkCandidates || []) {
    const suffix = candidate.relationId.split(":").at(-1) ||
      contentHash(candidate.id).slice(0, 24);
    const value: BehaviorValue = {
      id: `behavior:value:framework:${suffix}`,
      label: candidate.valueLabel,
      sensitivity: "internal",
      sourceNodeId: candidate.from,
    };
    add(
      {
        id: candidate.relationId,
        from: candidate.from,
        to: candidate.to,
        kind: candidate.kind,
        valueId: value.id,
        trust: candidate.trust,
        confidence: candidate.confidence,
        status: candidate.trust === "verified" ? "accepted" : "provisional",
        evidence: candidate.evidence,
        provenance: {
          analyzer: candidate.adapterId,
          version: candidate.adapterVersion,
          policy: candidate.ruleId,
          framework: candidate.framework,
          ruleId: candidate.ruleId,
          candidateId: candidate.id,
        },
      },
      value,
    );
  }

  for (const call of input.symbolCalls) {
    const caller = records.get(call.fromSourceSymbolId);
    const callee = records.get(call.toSourceSymbolId);
    if (!caller || !callee || caller.language !== callee.language) continue;
    const trust: BehaviorTrust = ["typescript", "javascript"].includes(
      caller.language,
    )
      ? "verified"
      : "inferred";
    const status = trust === "verified" ? "accepted" : "provisional";
    const analyzer =
      caller.language === "python"
        ? "python-direct-binding"
        : caller.language === "rust"
          ? "rust-direct-binding"
          : "typescript-typechecker-binding";
    for (const evidence of call.evidence.slice(0, 20)) {
      const bindings = bindArguments(caller, callee, evidence);
      if (!bindings) continue;
      for (const binding of bindings) {
        const suffix = contentHash(
          `${caller.symbol.id}:${callee.symbol.id}:${evidence.path}:${evidence.line}:${binding.parameter}:${binding.argument}`,
        ).slice(0, 20);
        const value: BehaviorValue = {
          id: `behavior:value:argument:${suffix}`,
          label: `${binding.argument} → ${binding.parameter}`.slice(0, 300),
          sensitivity: "unknown",
          sourceNodeId: caller.semanticId,
        };
        add(
          {
            id: `behavior:passes:${suffix}`,
            from: caller.semanticId,
            to: callee.semanticId,
            kind: "passes",
            valueId: value.id,
            trust,
            confidence: trust === "verified" ? 1 : 0.78,
            status,
            evidence: [evidence],
            provenance: provenance(analyzer),
          },
          value,
        );
      }
      if (
        trust === "verified" &&
        targetReturnsValue(callee, input.contents)
      ) {
        const consumer = callResultLabel(evidence);
        if (consumer) {
          const suffix = contentHash(
            `${callee.symbol.id}:${caller.symbol.id}:${evidence.path}:${evidence.line}:return:${consumer}`,
          ).slice(0, 20);
          const value: BehaviorValue = {
            id: `behavior:value:return:${suffix}`,
            label: `${callee.symbol.name} return → ${consumer}`,
            sensitivity: "unknown",
            sourceNodeId: callee.semanticId,
          };
          add(
            {
              id: `behavior:returns:${suffix}`,
              from: callee.semanticId,
              to: caller.semanticId,
              kind: "returns",
              valueId: value.id,
              trust: "verified",
              confidence: 1,
              status: "accepted",
              evidence: [evidence],
              provenance: provenance("typescript-typechecker-binding"),
            },
            value,
          );
        }
      }
    }
  }

  for (const relation of input.symbolRelations) {
    if (!(["reads", "writes"] as string[]).includes(relation.kind)) continue;
    const source = records.get(relation.fromSourceSymbolId);
    const target = records.get(relation.toSourceSymbolId);
    if (!source || !target) continue;
    const kind: BehaviorRelationKind =
      relation.kind === "reads" ? "reads-state" : "writes-state";
    const suffix = contentHash(
      `${kind}:${source.symbol.id}:${target.symbol.id}`,
    ).slice(0, 20);
    const value: BehaviorValue = {
      id: `behavior:value:state:${suffix}`,
      label: target.symbol.name,
      sensitivity: "internal",
      sourceNodeId: target.semanticId,
    };
    add(
      {
        id: `behavior:${kind}:${suffix}`,
        from: source.semanticId,
        to: target.semanticId,
        kind,
        valueId: value.id,
        trust: relation.trust,
        confidence: relation.confidence,
        status: relation.trust === "verified" ? "accepted" : "provisional",
        evidence: relation.evidence,
        provenance: provenance(`${relation.resolver}-state-binding`),
      },
      value,
    );
  }

  const behaviorRelations = [...relations.values()];
  const semanticById = new Map(
    input.semantic.nodes.map((node) => [node.id, node]),
  );
  const workflowParticipants = (workflow: SemanticNode) => {
    const participants = new Set<string>();
    if (workflow.sourceSymbolId) {
      const id = semanticSymbols.get(workflow.sourceSymbolId);
      if (id) participants.add(id);
    }
    const steps = new Set(
      input.semantic.relations
        .filter(
          (relation) =>
            relation.kind === "contains" && relation.from === workflow.id,
        )
        .map((relation) => relation.to),
    );
    for (const stepId of steps) {
      const step = semanticById.get(stepId);
      if (step?.sourceSymbolId) {
        const id = semanticSymbols.get(step.sourceSymbolId);
        if (id) participants.add(id);
      }
    }
    for (const relation of input.semantic.relations)
      if (relation.kind === "executes" && steps.has(relation.from))
        participants.add(relation.to);
    return participants;
  };
  const sideEffects = new Set<BehaviorRelationKind>([
    "reads-state",
    "writes-state",
    "persists",
    "publishes",
    "subscribes",
    "spawns",
    "raises",
    "handles",
    "routes-to",
  ]);
  const workflows = input.semantic.nodes
    .filter((node) => node.kind === "workflow")
    .map((workflow) => {
      const participants = workflowParticipants(workflow);
      const relevant = behaviorRelations.filter(
        (relation) =>
          participants.has(relation.from) || participants.has(relation.to),
      );
      return {
        workflowId: workflow.id,
        inputs: relevant
          .filter((relation) => relation.kind === "passes")
          .map((relation) => values.get(relation.valueId || "")?.label)
          .filter((label): label is string => Boolean(label)),
        outputs: relevant
          .filter((relation) => relation.kind === "returns")
          .map((relation) => values.get(relation.valueId || "")?.label)
          .filter((label): label is string => Boolean(label)),
        sideEffects: relevant
          .filter((relation) => sideEffects.has(relation.kind))
          .map((relation) => {
            const target = [...records.values()].find(
              (record) => record.semanticId === relation.to,
            );
            return target
              ? sideEffectLabel(relation.kind, target)
              : relation.kind;
          }),
        relationIds: relevant.map((relation) => relation.id),
      };
    });
  const canonical = {
    sourceRevision: input.sourceRevision,
    semanticRevision: input.semantic.revision,
    values: [...values.values()].sort((a, b) => a.id.localeCompare(b.id)),
    relations: behaviorRelations.sort((a, b) => a.id.localeCompare(b.id)),
    workflows: workflows.sort((a, b) => a.workflowId.localeCompare(b.workflowId)),
  };
  const revision = contentHash(JSON.stringify(canonical));
  return finalizeBehaviorGraph(
    {
      schemaVersion: 1,
      contract: "witch.behavior/v1",
      analyzerVersion: BEHAVIOR_ANALYZER_VERSION,
      policyVersion: BEHAVIOR_POLICY_VERSION,
      workspaceRoot: input.workspaceRoot,
      sourceRevision: input.sourceRevision,
      semanticRevision: input.semantic.revision,
      revision,
      generatedAt: input.generatedAt,
      values: canonical.values,
      relations: canonical.relations,
      workflows: canonical.workflows,
    },
    input.semantic,
    input.nodes,
  );
}
