import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ArchitectureEdge,
  ArchitectureGraph,
  ArchitectureNode,
  SourceEvidence,
} from "../../shared/architecture";
import type {
  SemanticClaim,
  SemanticGraph,
  SemanticNode,
  SemanticOpenQuestion,
  SemanticRelation,
  WorkflowStepKind,
} from "../../shared/semantic";
import { finalizeSemanticGraph } from "../../shared/semantic-ir";
import type {
  SemanticComposerDraft,
  SemanticComposerProviderId,
  SemanticComposerRequest,
  SemanticComposerResult,
  SemanticCompositionDiagnostic,
  SemanticCompositionReceipt,
} from "../../shared/semantic-composer";
import { validateSemanticComposerRequest } from "../../shared/semantic-composer";
import { cliEnvironment, prepareCliCommand } from "./cli-discovery";

type Candidate = {
  id: string;
  label: string;
  kind: "module" | "component";
  paths: string[];
  sourceNodeIds: string[];
  evidence: SourceEvidence[];
  score: number;
  symbols: string[];
  description?: string;
};

type CandidateRelation = {
  id: string;
  from: string;
  to: string;
  kind: string;
  count: number;
  sourceRelationIds: string[];
  evidence: SourceEvidence[];
};

type ComposerPacket = {
  sourceRevision: string;
  workspaceName: string;
  languages: string[];
  candidates: Candidate[];
  relations: CandidateRelation[];
  workflows: Array<{
    id: string;
    label: string;
    description?: string;
    candidateIds: string[];
    evidence: SourceEvidence[];
  }>;
  authoredClaims: Array<{
    subjectId: string;
    key: string;
    value: string;
    status: string;
  }>;
};

type CompletionOptions = {
  provider: Exclude<SemanticComposerProviderId, "rules">;
  model: string;
  prompt: string;
  schema: Record<string, unknown>;
};

const COMPOSER_ANALYZER = "witch-semantic-composer/v1";
const COMPOSER_POLICY = "bounded-evidence-auto-approve/v1";
const MAX_PROVIDER_OUTPUT = 4_000_000;

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const evidenceKey = (item: SourceEvidence) =>
  `${item.path}:${item.line}:${item.endLine || item.line}:${item.hash}`;

function uniqueEvidence(items: SourceEvidence[], limit = 40) {
  const result: SourceEvidence[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = evidenceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function safeId(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || hash(value).slice(0, 12);
}

function noisyPath(value: string) {
  return /(^|\/)(?:tests?|__tests__|docs?|examples?|fixtures?|generated|vendor|dist|build|coverage|\.github)(\/|$)/i.test(
    value,
  );
}

function moduleCandidates(graph: ArchitectureGraph): Candidate[] {
  const groups = new Map<string, ArchitectureNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== "file" || !node.path) continue;
    const current = groups.get(node.module) || [];
    current.push(node);
    groups.set(node.module, current);
  }
  return [...groups]
    .map(([module, nodes]) => {
      const symbols = nodes.flatMap((node) =>
        node.symbols.map((item) => item.name),
      );
      const publicSymbols = nodes.flatMap((node) =>
        node.symbols.filter((item) => item.exported).map((item) => item.name),
      );
      const score =
        Math.log2(nodes.length + 1) * 6 +
        Math.log2(symbols.length + 1) * 4 +
        Math.min(publicSymbols.length, 30) -
        (noisyPath(module) ? 35 : 0) -
        (module === "root" ? 12 : 0);
      return {
        id: `candidate:module:${module}`,
        label: module,
        kind: "module" as const,
        paths: nodes
          .map((node) => node.path!)
          .sort()
          .slice(0, 12),
        sourceNodeIds: nodes.map((node) => node.id).sort(),
        evidence: uniqueEvidence(nodes.flatMap((node) => node.evidence)),
        score,
        symbols: [...new Set([...publicSymbols, ...symbols])].slice(0, 24),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    );
}

function semanticCandidates(graph: ArchitectureGraph): Candidate[] {
  const sourceByPath = new Map(
    graph.nodes
      .filter((node) => node.kind === "file" && node.path)
      .map((node) => [node.path!, node]),
  );
  const degree = new Map<string, number>();
  for (const relation of graph.semantic?.relations || []) {
    degree.set(relation.from, (degree.get(relation.from) || 0) + 1);
    degree.set(relation.to, (degree.get(relation.to) || 0) + 1);
  }
  return (graph.semantic?.nodes || [])
    .filter(
      (node) =>
        !node.provenance.analyzer.startsWith(COMPOSER_ANALYZER) &&
        ["component", "package", "module", "file"].includes(node.kind) &&
        Boolean(node.path || node.evidence.length),
    )
    .map((node) => {
      const source = node.path ? sourceByPath.get(node.path) : undefined;
      const paths = [
        ...new Set(
          [node.path, ...node.evidence.map((item) => item.path)].filter(
            Boolean,
          ) as string[],
        ),
      ];
      const score =
        (degree.get(node.id) || 0) * 5 +
        node.confidence * 10 +
        Math.min(node.evidence.length, 5) * 2 -
        (paths.some(noisyPath) ? 22 : 0);
      return {
        id: `candidate:semantic:${node.id}`,
        label: node.label,
        kind: "component" as const,
        paths: paths.slice(0, 8),
        sourceNodeIds: source ? [source.id] : [],
        evidence: uniqueEvidence(node.evidence),
        score,
        symbols:
          source?.symbols.map((symbol) => symbol.name).slice(0, 20) || [],
        ...(node.description ? { description: node.description } : {}),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    )
    .slice(0, 100);
}

function architectureCandidateRelations(
  graph: ArchitectureGraph,
  modules: Candidate[],
): CandidateRelation[] {
  const moduleByNode = new Map<string, string>();
  for (const candidate of modules)
    for (const nodeId of candidate.sourceNodeIds)
      moduleByNode.set(nodeId, candidate.id);
  const aggregated = new Map<string, CandidateRelation>();
  for (const edge of graph.edges) {
    const from = moduleByNode.get(edge.from);
    const to = moduleByNode.get(edge.to);
    if (!from || !to || from === to) continue;
    const id = `candidate:relation:${from}->${to}`;
    const current = aggregated.get(id) || {
      id,
      from,
      to,
      kind: edge.kind,
      count: 0,
      sourceRelationIds: [],
      evidence: [],
    };
    current.count += edge.count;
    current.sourceRelationIds.push(edge.id);
    current.evidence.push(...edge.evidence);
    aggregated.set(id, current);
  }
  return [...aggregated.values()]
    .map((relation) => ({
      ...relation,
      sourceRelationIds: [...new Set(relation.sourceRelationIds)].sort(),
      evidence: uniqueEvidence(relation.evidence),
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.id.localeCompare(right.id),
    );
}

function semanticCandidateRelations(
  graph: ArchitectureGraph,
  candidates: Candidate[],
): CandidateRelation[] {
  const candidateBySemanticId = new Map(
    candidates
      .filter((candidate) => candidate.id.startsWith("candidate:semantic:"))
      .map((candidate) => [
        candidate.id.slice("candidate:semantic:".length),
        candidate.id,
      ]),
  );
  return (graph.semantic?.relations || [])
    .filter((relation) =>
      [
        "calls",
        "reads",
        "writes",
        "emits",
        "subscribes",
        "routes-to",
        "executes",
        "depends-on",
      ].includes(relation.kind),
    )
    .flatMap((relation) => {
      const from = candidateBySemanticId.get(relation.from);
      const to = candidateBySemanticId.get(relation.to);
      if (!from || !to || from === to) return [];
      return [
        {
          id: `candidate:semantic-relation:${relation.id}`,
          from,
          to,
          kind: relation.kind,
          count: 1,
          sourceRelationIds: [relation.id],
          evidence: uniqueEvidence(relation.evidence),
        },
      ];
    })
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 160);
}

function buildPacket(graph: ArchitectureGraph): ComposerPacket {
  const modules = moduleCandidates(graph);
  const semantic = semanticCandidates(graph);
  const candidates = [...modules, ...semantic].slice(0, 140);
  const moduleByPath = new Map<string, string>();
  for (const candidate of modules)
    for (const sourceId of candidate.sourceNodeIds) {
      const source = graph.nodes.find((node) => node.id === sourceId);
      if (source?.path) moduleByPath.set(source.path, candidate.id);
    }
  const workflows = (graph.semantic?.nodes || [])
    .filter(
      (node) =>
        node.kind === "workflow" &&
        !node.provenance.analyzer.startsWith(COMPOSER_ANALYZER),
    )
    .slice(0, 30)
    .map((node) => ({
      id: node.id,
      label: node.label,
      ...(node.description ? { description: node.description } : {}),
      candidateIds: [
        ...new Set(
          node.evidence
            .map((item) => moduleByPath.get(item.path))
            .filter(Boolean) as string[],
        ),
      ],
      evidence: uniqueEvidence(node.evidence, 8),
    }));
  return {
    sourceRevision: graph.revision,
    workspaceName: path.basename(graph.workspaceRoot),
    languages: [
      ...new Set(graph.nodes.map((node) => node.language).filter(Boolean)),
    ].sort(),
    candidates,
    relations: [
      ...architectureCandidateRelations(graph, modules),
      ...semanticCandidateRelations(graph, semantic),
    ].slice(0, 220),
    workflows,
    authoredClaims: (graph.semantic?.claims || [])
      .filter((claim) => claim.trust === "authored")
      .slice(0, 40)
      .map((claim) => ({
        subjectId: claim.subjectId,
        key: claim.key,
        value: claim.value,
        status: claim.status,
      })),
  };
}

function ruleDraft(
  packet: ComposerPacket,
  request: SemanticComposerRequest,
): SemanticComposerDraft {
  const modules = packet.candidates
    .filter((candidate) => candidate.kind === "module")
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    );
  const clean = modules.filter((candidate) => !noisyPath(candidate.label));
  const selected = (clean.length >= 4 ? clean : modules).slice(
    0,
    request.maxComponents,
  );
  const selectedCandidates = new Set(selected.map((candidate) => candidate.id));
  const components = selected.map((candidate) => ({
    id: safeId(candidate.label),
    label: candidate.label === "root" ? packet.workspaceName : candidate.label,
    kind: "component" as const,
    responsibility: candidate.symbols.length
      ? `Owns ${candidate.symbols.slice(0, 4).join(", ")}.`
      : `Groups ${candidate.paths.slice(0, 3).join(", ")}.`,
    candidateIds: [candidate.id],
    confidence: 0.68,
  }));
  const componentByCandidate = new Map(
    components.map((component) => [component.candidateIds[0], component.id]),
  );
  const relations = packet.relations
    .filter(
      (relation) =>
        selectedCandidates.has(relation.from) &&
        selectedCandidates.has(relation.to),
    )
    .slice(0, 32)
    .map((relation) => ({
      from: componentByCandidate.get(relation.from)!,
      to: componentByCandidate.get(relation.to)!,
      kind: "depends-on" as const,
      label: relation.kind,
      candidateRelationIds: [relation.id],
      confidence: 0.72,
    }));
  const workflows = packet.workflows
    .map((workflow) => ({
      ...workflow,
      componentIds: workflow.candidateIds
        .map((candidateId) => componentByCandidate.get(candidateId))
        .filter(Boolean) as string[],
    }))
    .filter((workflow) => workflow.componentIds.length)
    .slice(0, request.focus === "workflow" ? 6 : 3)
    .map((workflow) => ({
      id: safeId(workflow.id),
      label: workflow.label,
      description:
        workflow.description || "Source-inferred workflow candidate.",
      componentIds: workflow.componentIds,
      sourceWorkflowIds: [workflow.id],
      confidence: 0.62,
    }));
  return {
    title: packet.workspaceName,
    summary: `Rule-based composition of ${components.length} source-backed components.`,
    components,
    relations,
    workflows,
    questions: relations.length
      ? []
      : components.slice(0, 1).map((component) => ({
          subjectId: component.id,
          prompt:
            "Static imports do not reveal a primary runtime path. Which component is the runtime entry point?",
          recommendation: component.label,
          options: [
            component.label,
            "Leave the runtime entry point unresolved",
          ],
        })),
  };
}

const relationKinds = new Set([
  "calls",
  "reads",
  "writes",
  "emits",
  "subscribes",
  "routes-to",
  "executes",
  "depends-on",
]);

export function validateSemanticComposerDraft(
  value: unknown,
  maxComponents = 12,
): SemanticComposerDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Semantic Composer returned a non-object response");
  const draft = value as SemanticComposerDraft;
  if (
    typeof draft.title !== "string" ||
    !draft.title.trim() ||
    draft.title.length > 160 ||
    typeof draft.summary !== "string" ||
    draft.summary.length > 2_000 ||
    !Array.isArray(draft.components) ||
    draft.components.length < 1 ||
    draft.components.length > maxComponents ||
    !Array.isArray(draft.relations) ||
    draft.relations.length > 60 ||
    !Array.isArray(draft.workflows) ||
    draft.workflows.length > 8 ||
    !Array.isArray(draft.questions) ||
    draft.questions.length > 16
  )
    throw new Error("Semantic Composer response exceeds the bounded contract");
  const ids = new Set<string>();
  for (const component of draft.components) {
    if (
      !component ||
      typeof component.id !== "string" ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(component.id) ||
      ids.has(component.id) ||
      typeof component.label !== "string" ||
      !component.label.trim() ||
      component.label.length > 120 ||
      !["component", "external-system"].includes(component.kind) ||
      typeof component.responsibility !== "string" ||
      !component.responsibility.trim() ||
      component.responsibility.length > 1_000 ||
      !Array.isArray(component.candidateIds) ||
      !component.candidateIds.length ||
      component.candidateIds.length > 30 ||
      component.candidateIds.some((id) => typeof id !== "string") ||
      !Number.isFinite(component.confidence) ||
      component.confidence < 0 ||
      component.confidence > 1
    )
      throw new Error("Semantic Composer returned an invalid component");
    ids.add(component.id);
  }
  for (const relation of draft.relations) {
    if (
      !relation ||
      !ids.has(relation.from) ||
      !ids.has(relation.to) ||
      relation.from === relation.to ||
      !relationKinds.has(relation.kind) ||
      typeof relation.label !== "string" ||
      relation.label.length > 160 ||
      !Array.isArray(relation.candidateRelationIds) ||
      relation.candidateRelationIds.length > 20 ||
      relation.candidateRelationIds.some((id) => typeof id !== "string") ||
      !Number.isFinite(relation.confidence) ||
      relation.confidence < 0 ||
      relation.confidence > 1
    )
      throw new Error("Semantic Composer returned an invalid relation");
  }
  for (const workflow of draft.workflows) {
    if (
      !workflow ||
      typeof workflow.id !== "string" ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(workflow.id) ||
      typeof workflow.label !== "string" ||
      !workflow.label.trim() ||
      workflow.label.length > 140 ||
      typeof workflow.description !== "string" ||
      workflow.description.length > 1_200 ||
      !Array.isArray(workflow.componentIds) ||
      !workflow.componentIds.length ||
      workflow.componentIds.length > 20 ||
      workflow.componentIds.some((id) => !ids.has(id)) ||
      !Array.isArray(workflow.sourceWorkflowIds) ||
      workflow.sourceWorkflowIds.length > 20 ||
      !Number.isFinite(workflow.confidence) ||
      workflow.confidence < 0 ||
      workflow.confidence > 1
    )
      throw new Error("Semantic Composer returned an invalid workflow");
  }
  for (const question of draft.questions) {
    if (
      !question ||
      !ids.has(question.subjectId) ||
      typeof question.prompt !== "string" ||
      !question.prompt.trim() ||
      question.prompt.length > 1_000 ||
      typeof question.recommendation !== "string" ||
      !question.recommendation.trim() ||
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 8 ||
      question.options.some(
        (option) => typeof option !== "string" || !option.trim(),
      )
    )
      throw new Error("Semantic Composer returned an invalid question");
  }
  return draft;
}

export const semanticComposerSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "summary",
    "components",
    "relations",
    "workflows",
    "questions",
  ],
  properties: {
    title: { type: "string", maxLength: 160 },
    summary: { type: "string", maxLength: 2000 },
    components: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "kind",
          "responsibility",
          "candidateIds",
          "confidence",
        ],
        properties: {
          id: { type: "string", pattern: "^[a-zA-Z0-9._-]{1,100}$" },
          label: { type: "string", maxLength: 120 },
          kind: { type: "string", enum: ["component", "external-system"] },
          responsibility: { type: "string", maxLength: 1000 },
          candidateIds: {
            type: "array",
            minItems: 1,
            maxItems: 30,
            items: { type: "string" },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    relations: {
      type: "array",
      maxItems: 60,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "from",
          "to",
          "kind",
          "label",
          "candidateRelationIds",
          "confidence",
        ],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          kind: { type: "string", enum: [...relationKinds] },
          label: { type: "string", maxLength: 160 },
          candidateRelationIds: {
            type: "array",
            maxItems: 20,
            items: { type: "string" },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    workflows: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "description",
          "componentIds",
          "sourceWorkflowIds",
          "confidence",
        ],
        properties: {
          id: { type: "string", pattern: "^[a-zA-Z0-9._-]{1,100}$" },
          label: { type: "string", maxLength: 140 },
          description: { type: "string", maxLength: 1200 },
          componentIds: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: { type: "string" },
          },
          sourceWorkflowIds: {
            type: "array",
            maxItems: 20,
            items: { type: "string" },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    questions: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subjectId", "prompt", "recommendation", "options"],
        properties: {
          subjectId: { type: "string" },
          prompt: { type: "string", maxLength: 1000 },
          recommendation: { type: "string", maxLength: 500 },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 8,
            items: { type: "string", maxLength: 500 },
          },
        },
      },
    },
  },
};

function promptFor(packet: ComposerPacket, request: SemanticComposerRequest) {
  const boundedPacket = {
    ...packet,
    candidates: packet.candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      kind: candidate.kind,
      paths: candidate.paths,
      score: Math.round(candidate.score * 100) / 100,
      symbols: candidate.symbols,
      ...(candidate.description ? { description: candidate.description } : {}),
    })),
    relations: packet.relations.map((relation) => ({
      id: relation.id,
      from: relation.from,
      to: relation.to,
      kind: relation.kind,
      count: relation.count,
    })),
    workflows: packet.workflows.map(
      ({ evidence: _evidence, ...workflow }) => workflow,
    ),
  };
  return [
    "You are Witch Semantic Composer. Turn bounded source-derived candidates into a concise system map.",
    `Focus: ${request.focus}. Select at most ${request.maxComponents} components.`,
    "Use only supplied candidateIds, candidateRelationIds, sourceWorkflowIds, and component IDs you create.",
    "Group files/modules by runtime responsibility, prefer runtime paths over tests/docs/generated folders, and keep one primary path readable.",
    "A relation without a matching candidateRelationId will be rejected. Do not claim runtime behavior beyond the supplied static evidence.",
    "Questions should expose unresolved architecture intent or conflicts. Return only the schema-conforming object.",
    JSON.stringify(boundedPacket),
  ].join("\n\n");
}

function parseJsonText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("AI provider returned an empty response");
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    throw new Error("AI provider did not return valid JSON");
  }
}

async function runProcess(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs = 180_000,
) {
  const prepared = prepareCliCommand(command, args, {
    cwd,
    env: cliEnvironment(command),
    windowsHide: true,
  });
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(prepared.command, prepared.args, {
      ...prepared.options,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("AI provider timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_PROVIDER_OUTPUT) {
        child.kill();
        finish(new Error("AI provider output exceeded 4 MB"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-200_000);
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (code === 0) finish();
      else
        finish(
          new Error(
            `AI provider exited with code ${code}: ${stderr.trim().slice(-1200) || "no diagnostic"}`,
          ),
        );
    });
    child.stdin.end(input);
  });
}

async function codexCompletion(command: string, options: CompletionOptions) {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-composer-codex-"),
  );
  try {
    const schemaPath = path.join(temporary, "composition.schema.json");
    const outputPath = path.join(temporary, "composition.json");
    await fs.writeFile(schemaPath, JSON.stringify(options.schema), "utf8");
    const portable = (value: string) => value.replaceAll("\\", "/");
    const args = [
      "exec",
      "--ignore-user-config",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
      "--output-schema",
      portable(schemaPath),
      "--output-last-message",
      portable(outputPath),
      "--color",
      "never",
      "-C",
      portable(temporary),
      ...(options.model !== "cli-default" ? ["--model", options.model] : []),
      "-",
    ];
    await runProcess(command, args, options.prompt, temporary);
    const bytes = await fs.readFile(outputPath);
    if (bytes.length > MAX_PROVIDER_OUTPUT)
      throw new Error("Codex structured output exceeded 4 MB");
    return parseJsonText(bytes.toString("utf8"));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function claudeCompletion(command: string, options: CompletionOptions) {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-composer-claude-"),
  );
  try {
    const mcpPath = path.join(temporary, "empty-mcp.json");
    await fs.writeFile(mcpPath, '{"mcpServers":{}}', "utf8");
    const portable = (value: string) => value.replaceAll("\\", "/");
    const supportsSchemaArgument =
      process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command);
    const args = [
      "--print",
      "--output-format",
      "json",
      "--permission-mode",
      "plan",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--mcp-config",
      portable(mcpPath),
      "--tools=",
      ...(supportsSchemaArgument
        ? ["--json-schema", JSON.stringify(options.schema)]
        : []),
      ...(options.model !== "cli-default" ? ["--model", options.model] : []),
    ];
    const { stdout } = await runProcess(
      command,
      args,
      options.prompt,
      temporary,
    );
    const envelope = parseJsonText(stdout) as any;
    if (envelope?.structured_output) return envelope.structured_output;
    if (typeof envelope?.result === "string")
      return parseJsonText(envelope.result);
    if (envelope?.result && typeof envelope.result === "object")
      return envelope.result;
    return envelope;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_PROVIDER_OUTPUT)
    throw new Error("AI provider response exceeded 4 MB");
  if (!response.ok) {
    let message = text.slice(0, 1_200);
    try {
      const parsed = JSON.parse(text);
      message = parsed?.error?.message || message;
    } catch {
      /* Keep bounded text diagnostic. */
    }
    throw new Error(
      `AI provider request failed (${response.status}): ${message}`,
    );
  }
  return parseJsonText(text) as any;
}

async function openAiCompletion(
  key: string,
  options: CompletionOptions,
  fetcher: typeof fetch,
) {
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      store: false,
      instructions:
        "Return a source-grounded Witch Semantic Composer object. Do not use tools or invent candidate IDs.",
      input: options.prompt,
      max_output_tokens: 8_000,
      text: {
        format: {
          type: "json_schema",
          name: "witch_semantic_composition",
          schema: options.schema,
          strict: true,
        },
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const value = await readResponseBody(response);
  const output =
    typeof value.output_text === "string"
      ? value.output_text
      : value.output
          ?.flatMap((item: any) => item.content || [])
          .find((item: any) => item.type === "output_text")?.text;
  if (typeof output !== "string")
    throw new Error("OpenAI returned no structured output text");
  return parseJsonText(output);
}

async function anthropicCompletion(
  key: string,
  options: CompletionOptions,
  fetcher: typeof fetch,
) {
  const response = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: 8_000,
      system:
        "Return a source-grounded Witch Semantic Composer object. Do not use tools or invent candidate IDs.",
      messages: [{ role: "user", content: options.prompt }],
      output_config: {
        format: { type: "json_schema", schema: options.schema },
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const value = await readResponseBody(response);
  const output = value.content?.find((item: any) => item.type === "text")?.text;
  if (typeof output !== "string")
    throw new Error("Anthropic returned no structured output text");
  return parseJsonText(output);
}

function inferStepKind(label: string): WorkflowStepKind {
  const value = label.toLowerCase();
  if (/auth|valid|guard|risk/.test(value)) return "validate";
  if (/plan|agent|reason|infer/.test(value)) return "infer";
  if (/tool|command|exec|runner/.test(value)) return "tool-call";
  if (/store|db|persist|repository/.test(value)) return "persist";
  if (/publish|emit|event|queue/.test(value)) return "publish";
  return "execute";
}

function applyDraft(
  graph: ArchitectureGraph,
  packet: ComposerPacket,
  draft: SemanticComposerDraft,
  metadata: {
    provider: SemanticComposerProviderId;
    model: string;
    inputHash: string;
    promptHash: string;
    fallback: boolean;
    diagnostics: SemanticCompositionDiagnostic[];
  },
): SemanticComposerResult {
  if (!graph.semantic) throw new Error("Semantic analysis is unavailable");
  const candidateById = new Map(
    packet.candidates.map((item) => [item.id, item]),
  );
  const candidateRelationById = new Map(
    packet.relations.map((item) => [item.id, item]),
  );
  const workflowById = new Map(packet.workflows.map((item) => [item.id, item]));
  const sourceNodeIds = new Set(graph.nodes.map((node) => node.id));
  const base = graph.semantic;
  const keepNode = (node: SemanticNode) =>
    !node.provenance.analyzer.startsWith(COMPOSER_ANALYZER);
  const keepRelation = (relation: SemanticRelation) =>
    !relation.provenance.analyzer.startsWith(COMPOSER_ANALYZER);
  const keepClaim = (claim: SemanticClaim) =>
    !claim.provenance.analyzer.startsWith(COMPOSER_ANALYZER);
  const nodes = base.nodes.filter(keepNode);
  const relations = base.relations.filter(keepRelation);
  const claims = base.claims.filter(keepClaim);
  const questions = base.questions.filter(
    (question) => !question.id.startsWith("compose:question:"),
  );
  const existingQuestionCount = questions.length;
  const now = new Date().toISOString();
  const compositionRevision = hash(
    `${graph.revision}:${metadata.provider}:${metadata.model}:${JSON.stringify(draft)}`,
  );
  const provenance = {
    source: (metadata.provider === "rules" ? "heuristic" : "ai-composer") as
      "heuristic" | "ai-composer",
    analyzer: COMPOSER_ANALYZER,
    policy: COMPOSER_POLICY,
    model: metadata.model,
  };
  const componentId = new Map<string, string>();
  const componentEvidence = new Map<string, SourceEvidence[]>();
  let rejectedCount = 0;

  for (const component of draft.components) {
    const candidateIds = [...new Set(component.candidateIds)].filter((id) =>
      candidateById.has(id),
    );
    if (!candidateIds.length) {
      rejectedCount++;
      metadata.diagnostics.push({
        code: "COMPOSITION_COMPONENT_UNGROUNDED",
        severity: "warning",
        subject: component.id,
        message:
          "Component was rejected because none of its candidate IDs exist in the source packet.",
      });
      continue;
    }
    const candidates = candidateIds.map((id) => candidateById.get(id)!);
    const evidence = uniqueEvidence(
      candidates.flatMap((item) => item.evidence),
    );
    const sourceIds = candidates
      .flatMap((item) => item.sourceNodeIds)
      .filter((id) => sourceNodeIds.has(id));
    const id = `compose:component:${safeId(component.id)}`;
    componentId.set(component.id, id);
    componentEvidence.set(component.id, evidence);
    nodes.push({
      id,
      label: component.label.trim(),
      kind: component.kind,
      trust: "inferred",
      status: "provisional",
      confidence: component.confidence,
      ...(candidates[0].paths[0] ? { path: candidates[0].paths[0] } : {}),
      ...(sourceIds[0] ? { sourceNodeId: sourceIds[0] } : {}),
      description: component.responsibility.trim(),
      evidence,
      provenance,
    });
    const responsibilityClaim: SemanticClaim = {
      id: `compose:claim:${safeId(component.id)}:responsibility`,
      subjectId: id,
      key: "responsibility",
      value: component.responsibility.trim(),
      trust: "inferred",
      status: "provisional",
      confidence: component.confidence,
      reason: `Semantic Composer grouped ${candidateIds.length} source-derived candidate${candidateIds.length === 1 ? "" : "s"}.`,
      evidence,
      provenance,
    };
    claims.push(responsibilityClaim);
    const authored = base.claims.filter(
      (claim) =>
        claim.trust === "authored" &&
        candidateIds.includes(`candidate:semantic:${claim.subjectId}`),
    );
    authored.forEach((claim, index) => {
      const authoredId = `compose:claim:${safeId(component.id)}:authored:${index + 1}`;
      const conflicts =
        claim.key === "responsibility" &&
        claim.value.trim().toLowerCase() !==
          responsibilityClaim.value.trim().toLowerCase();
      const corroborates =
        claim.key === "responsibility" &&
        claim.value.trim().toLowerCase() ===
          responsibilityClaim.value.trim().toLowerCase();
      if (conflicts) responsibilityClaim.status = "conflicting";
      else if (corroborates) responsibilityClaim.status = "corroborated";
      claims.push({
        ...claim,
        id: authoredId,
        subjectId: id,
        status: conflicts
          ? "conflicting"
          : corroborates
            ? "corroborated"
            : claim.status,
        provenance: {
          source: "authored",
          analyzer: COMPOSER_ANALYZER,
          policy: "authored-vs-inferred/v1",
        },
      });
      if (conflicts)
        questions.push({
          id: `compose:question:${safeId(component.id)}:authored-${index + 1}`,
          subjectId: id,
          claimIds: [responsibilityClaim.id, authoredId],
          prompt: `The AI-composed responsibility conflicts with the authored description. Which should define ${component.label}?`,
          recommendation: responsibilityClaim.value,
          options: [responsibilityClaim.value, claim.value],
          status: "open",
          evidence: uniqueEvidence([
            ...responsibilityClaim.evidence,
            ...claim.evidence,
          ]),
        });
    });
  }

  if (!componentId.size)
    throw new Error(
      "Semantic Composer produced no source-grounded components after validation",
    );

  const systemEvidence = uniqueEvidence(
    [...componentEvidence.values()].flatMap((items) => items),
  );
  const systemId = "compose:system:workspace";
  nodes.push({
    id: systemId,
    label: draft.title.trim(),
    kind: "system",
    trust: "inferred",
    status: "provisional",
    confidence: 0.74,
    description: draft.summary.trim(),
    evidence: systemEvidence,
    provenance,
  });
  for (const [localId, id] of componentId) {
    relations.push({
      id: `compose:contains:${safeId(localId)}`,
      from: systemId,
      to: id,
      kind: "contains",
      trust: "inferred",
      status: "provisional",
      confidence: 0.8,
      evidence: componentEvidence.get(localId) || [],
      provenance,
    });
  }

  for (const relation of draft.relations) {
    const from = componentId.get(relation.from);
    const to = componentId.get(relation.to);
    const grounded = [...new Set(relation.candidateRelationIds)]
      .map((id) => candidateRelationById.get(id))
      .filter(Boolean) as CandidateRelation[];
    const endpointMatches = grounded.filter((candidate) => {
      const source = draft.components.find((item) => item.id === relation.from);
      const target = draft.components.find((item) => item.id === relation.to);
      return Boolean(
        source?.candidateIds.includes(candidate.from) &&
        target?.candidateIds.includes(candidate.to),
      );
    });
    if (!from || !to || !endpointMatches.length) {
      rejectedCount++;
      metadata.diagnostics.push({
        code: "COMPOSITION_RELATION_UNGROUNDED",
        severity: "warning",
        subject: `${relation.from}->${relation.to}`,
        message:
          "Relation was rejected because its cited source relation does not connect the selected candidates.",
      });
      continue;
    }
    relations.push({
      id: `compose:relation:${safeId(`${relation.from}-${relation.kind}-${relation.to}`)}`,
      from,
      to,
      kind: relation.kind,
      trust: "inferred",
      status: "provisional",
      confidence: relation.confidence,
      ...(relation.label.trim() ? { description: relation.label.trim() } : {}),
      evidence: uniqueEvidence(
        endpointMatches.flatMap((item) => item.evidence),
      ),
      provenance,
    });
  }

  for (const workflow of draft.workflows) {
    const ordered = workflow.componentIds
      .map((id) => [id, componentId.get(id)] as const)
      .filter((item): item is readonly [string, string] => Boolean(item[1]));
    const sources = workflow.sourceWorkflowIds
      .map((id) => workflowById.get(id))
      .filter(Boolean) as ComposerPacket["workflows"];
    if (!ordered.length || (!sources.length && metadata.provider !== "rules")) {
      rejectedCount++;
      metadata.diagnostics.push({
        code: "COMPOSITION_WORKFLOW_UNGROUNDED",
        severity: "warning",
        subject: workflow.id,
        message:
          "Workflow was rejected because it lacks a source workflow or grounded component sequence.",
      });
      continue;
    }
    const workflowId = `compose:workflow:${safeId(workflow.id)}`;
    const evidence = uniqueEvidence([
      ...sources.flatMap((source) => source.evidence),
      ...ordered.flatMap(([localId]) => componentEvidence.get(localId) || []),
    ]);
    nodes.push({
      id: workflowId,
      label: workflow.label,
      kind: "workflow",
      trust: "inferred",
      status: "provisional",
      confidence: workflow.confidence,
      description: workflow.description,
      evidence,
      provenance,
    });
    relations.push({
      id: `compose:contains-workflow:${safeId(workflow.id)}`,
      from: systemId,
      to: workflowId,
      kind: "contains",
      trust: "inferred",
      status: "provisional",
      confidence: workflow.confidence,
      evidence,
      provenance,
    });
    let previousStep: string | null = null;
    ordered.forEach(([localId, targetId], index) => {
      const component = draft.components.find((item) => item.id === localId)!;
      const stepId = `${workflowId}:step:${index + 1}`;
      const stepEvidence = componentEvidence.get(localId) || [];
      nodes.push({
        id: stepId,
        label: component.label,
        kind: "workflow-step",
        stepKind: inferStepKind(
          `${component.label} ${component.responsibility}`,
        ),
        trust: "inferred",
        status: "provisional",
        confidence: Math.min(workflow.confidence, component.confidence),
        description: component.responsibility,
        evidence: stepEvidence,
        provenance,
      });
      relations.push(
        {
          id: `${workflowId}:contains:${index + 1}`,
          from: workflowId,
          to: stepId,
          kind: "contains",
          trust: "inferred",
          status: "provisional",
          confidence: workflow.confidence,
          evidence: stepEvidence,
          provenance,
        },
        {
          id: `${workflowId}:executes:${index + 1}`,
          from: stepId,
          to: targetId,
          kind: "executes",
          trust: "inferred",
          status: "provisional",
          confidence: workflow.confidence,
          evidence: stepEvidence,
          provenance,
        },
      );
      if (previousStep)
        relations.push({
          id: `${workflowId}:precedes:${index}`,
          from: previousStep,
          to: stepId,
          kind: "precedes",
          trust: "inferred",
          status: "provisional",
          confidence: workflow.confidence,
          evidence: stepEvidence,
          provenance,
        });
      previousStep = stepId;
    });
  }

  draft.questions.forEach((question, index) => {
    const subjectId = componentId.get(question.subjectId);
    if (!subjectId) return;
    const evidence = componentEvidence.get(question.subjectId) || [];
    const item: SemanticOpenQuestion = {
      id: `compose:question:${safeId(question.subjectId)}:${index + 1}`,
      subjectId,
      claimIds: [],
      prompt: question.prompt,
      recommendation: question.recommendation,
      options: question.options,
      status: "open",
      evidence,
    };
    questions.push(item);
  });

  const composedSemantic = finalizeSemanticGraph(
    {
      ...base,
      sourceRevision: graph.revision,
      revision: compositionRevision,
      generatedAt: now,
      analyzerVersion: `${base.analyzerVersion}+composer-v1`,
      policyVersion: `${base.policyVersion}+${COMPOSER_POLICY}`,
      nodes,
      relations,
      claims,
      questions,
      revisions: [
        ...base.revisions,
        {
          id: compositionRevision,
          parentRevision: base.revision,
          sourceRevision: graph.revision,
          createdAt: now,
          analyzerVersion: COMPOSER_ANALYZER,
          policyVersion: COMPOSER_POLICY,
          approval: "provisional-inference",
          changedIds: [
            ...nodes
              .filter((node) => node.provenance.analyzer === COMPOSER_ANALYZER)
              .map((node) => node.id),
            ...relations
              .filter(
                (relation) =>
                  relation.provenance.analyzer === COMPOSER_ANALYZER,
              )
              .map((relation) => relation.id),
            ...claims
              .filter(
                (claim) => claim.provenance.analyzer === COMPOSER_ANALYZER,
              )
              .map((claim) => claim.id),
          ],
          summary: {
            nodesAdded: nodes.filter(
              (node) => node.provenance.analyzer === COMPOSER_ANALYZER,
            ).length,
            nodesChanged: 0,
            nodesRemoved: 0,
            relationsAdded: relations.filter(
              (relation) => relation.provenance.analyzer === COMPOSER_ANALYZER,
            ).length,
            relationsChanged: 0,
            relationsRemoved: 0,
            claimsAdded: claims.filter(
              (claim) => claim.provenance.analyzer === COMPOSER_ANALYZER,
            ).length,
            claimsChanged: 0,
            claimsRemoved: 0,
            questionsOpened: questions.length - existingQuestionCount,
          },
        },
      ],
    },
    graph.nodes,
  );
  const receipt: SemanticCompositionReceipt = {
    contract: "witch.composition/v1",
    valid: composedSemantic.validation.valid,
    provider: metadata.provider,
    model: metadata.model,
    sourceRevision: graph.revision,
    revision: compositionRevision,
    generatedAt: now,
    inputHash: metadata.inputHash,
    promptHash: metadata.promptHash,
    autoApproved: true,
    fallback: metadata.fallback,
    componentCount: [...componentId.values()].length,
    relationCount: relations.filter(
      (relation) =>
        relation.provenance.analyzer === COMPOSER_ANALYZER &&
        relation.kind !== "contains",
    ).length,
    workflowCount: nodes.filter(
      (node) =>
        node.provenance.analyzer === COMPOSER_ANALYZER &&
        node.kind === "workflow",
    ).length,
    questionCount: questions.length - existingQuestionCount,
    rejectedCount,
    diagnostics: metadata.diagnostics,
  };
  const {
    behavior: _staleBehavior,
    frameworks: _staleFrameworks,
    ...sourceGraph
  } = graph;
  return {
    // Behavior endpoints are tied to an exact semantic revision. A composed
    // semantic graph must be re-analyzed before it can receive a new overlay.
    graph: { ...sourceGraph, semantic: composedSemantic, composition: receipt },
    receipt,
  };
}

export class SemanticComposerService {
  constructor(
    private options: {
      codexCommand: () => string | null;
      claudeCommand: () => string | null;
      readApiKey: (provider: "openai" | "anthropic") => Promise<string | null>;
      fetch?: typeof fetch;
      defaults?: Partial<Record<"openai" | "anthropic", string>>;
      complete?: (options: CompletionOptions) => Promise<unknown>;
    },
  ) {}

  async compose(
    graph: ArchitectureGraph,
    input: SemanticComposerRequest,
  ): Promise<SemanticComposerResult> {
    const request = validateSemanticComposerRequest(input);
    if (!graph.validation.valid || !graph.semantic?.validation.valid)
      throw new Error(
        "Run a valid source and semantic analysis before composing",
      );
    const packet = buildPacket(graph);
    if (!packet.candidates.length)
      throw new Error("No source-backed component candidates are available");
    const prompt = promptFor(packet, request);
    const inputHash = hash(JSON.stringify(packet));
    const promptHash = hash(prompt);
    const diagnostics: SemanticCompositionDiagnostic[] = [];
    let provider = request.provider;
    let model = "rules-v1";
    let draft: SemanticComposerDraft;
    let fallback = false;

    if (provider === "rules") {
      draft = ruleDraft(packet, request);
    } else {
      model =
        request.model ||
        (provider === "openai"
          ? this.options.defaults?.openai || "gpt-5.4-mini"
          : provider === "anthropic"
            ? this.options.defaults?.anthropic || "claude-sonnet-4-6"
            : "cli-default");
      try {
        const completion: CompletionOptions = {
          provider,
          model,
          prompt,
          schema: semanticComposerSchema,
        };
        const value = this.options.complete
          ? await this.options.complete(completion)
          : await this.complete(completion);
        draft = validateSemanticComposerDraft(value, request.maxComponents);
      } catch (error) {
        if (!request.fallbackToRules) throw error;
        fallback = true;
        diagnostics.push({
          code: "COMPOSITION_PROVIDER_FALLBACK",
          severity: "warning",
          subject: provider,
          message: `${error instanceof Error ? error.message : error} Rules-only composition was used and the requested provider remains in the audit receipt.`,
        });
        draft = ruleDraft(packet, request);
      }
    }
    try {
      return applyDraft(graph, packet, draft, {
        provider,
        model,
        inputHash,
        promptHash,
        fallback,
        diagnostics,
      });
    } catch (error) {
      if (provider === "rules" || fallback || request.fallbackToRules === false)
        throw error;
      diagnostics.push({
        code: "COMPOSITION_GROUNDING_FALLBACK",
        severity: "warning",
        subject: provider,
        message: `${error instanceof Error ? error.message : error} Rules-only composition was used after evidence validation.`,
      });
      return applyDraft(graph, packet, ruleDraft(packet, request), {
        provider,
        model,
        inputHash,
        promptHash,
        fallback: true,
        diagnostics,
      });
    }
  }

  private async complete(options: CompletionOptions) {
    if (options.provider === "codex") {
      const command = this.options.codexCommand();
      if (!command) throw new Error("Codex CLI is not installed");
      return codexCompletion(command, options);
    }
    if (options.provider === "claude") {
      const command = this.options.claudeCommand();
      if (!command) throw new Error("Claude Code CLI is not installed");
      return claudeCompletion(command, options);
    }
    const key = await this.options.readApiKey(options.provider);
    if (!key)
      throw new Error(
        `${options.provider === "openai" ? "OpenAI" : "Anthropic"} API key is not configured`,
      );
    const fetcher = this.options.fetch || fetch;
    return options.provider === "openai"
      ? openAiCompletion(key, options, fetcher)
      : anthropicCompletion(key, options, fetcher);
  }
}
