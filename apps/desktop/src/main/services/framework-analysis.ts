import type {
  ArchitectureNode,
  CodeSymbol,
  SourceEvidence,
} from "../../shared/architecture";
import type {
  FrameworkCandidate,
  FrameworkCoverage,
  FrameworkDiagnostic,
  FrameworkGraph,
  FrameworkId,
  FrameworkLanguage,
} from "../../shared/framework";
import { finalizeFrameworkGraph } from "../../shared/framework-ir";
import type { SemanticGraph } from "../../shared/semantic";
import { contentHash } from "./workspace-files";

export const FRAMEWORK_ANALYZER_VERSION = "framework-static-v1";
export const FRAMEWORK_POLICY_VERSION = "explicit-registration-evidence-v1";
const ADAPTER_VERSION = "1.0.0";
const MAX_CANDIDATES = 5_000;
const MAX_DIAGNOSTICS = 200;

const FRAMEWORKS: FrameworkId[] = [
  "fastapi",
  "langgraph",
  "celery",
  "express",
  "nestjs",
  "nextjs",
  "axum",
  "tokio",
];

type SymbolRecord = {
  node: ArchitectureNode;
  symbol: CodeSymbol;
  semanticId: string;
};

type MutableCoverage = {
  detected: Set<string>;
  analyzed: Set<string>;
  candidates: number;
  excluded: number;
  limitReached: boolean;
};

const languageFor = (node: ArchitectureNode): FrameworkLanguage | null => {
  if (node.language === "py") return "python";
  if (node.language === "rs") return "rust";
  if (["ts", "tsx", "mts", "cts"].includes(node.language))
    return "typescript";
  if (["js", "jsx", "mjs", "cjs"].includes(node.language))
    return "javascript";
  return null;
};

const adapterId = (framework: FrameworkId) => `witch.${framework}-adapter`;

export function analyzeFrameworks(input: {
  workspaceRoot: string;
  sourceRevision: string;
  generatedAt: string;
  nodes: ArchitectureNode[];
  semantic: SemanticGraph;
  contents: Map<string, string>;
}): FrameworkGraph {
  const semanticFiles = new Map(
    input.semantic.nodes
      .filter((node) => node.kind === "file" && node.sourceNodeId)
      .map((node) => [node.sourceNodeId!, node.id]),
  );
  const semanticSymbols = new Map(
    input.semantic.nodes
      .filter((node) => node.kind === "symbol" && node.sourceSymbolId)
      .map((node) => [node.sourceSymbolId!, node.id]),
  );
  const records: SymbolRecord[] = [];
  for (const node of input.nodes)
    for (const symbol of node.symbols) {
      const semanticId = semanticSymbols.get(symbol.id);
      if (semanticId) records.push({ node, symbol, semanticId });
    }
  const byFile = new Map<string, SymbolRecord[]>();
  const byName = new Map<string, SymbolRecord[]>();
  for (const record of records) {
    const inFile = byFile.get(record.node.id) || [];
    inFile.push(record);
    byFile.set(record.node.id, inFile);
    const named = byName.get(record.symbol.name) || [];
    named.push(record);
    byName.set(record.symbol.name, named);
  }
  const coverage = new Map<FrameworkId, MutableCoverage>(
    FRAMEWORKS.map((framework) => [
      framework,
      {
        detected: new Set<string>(),
        analyzed: new Set<string>(),
        candidates: 0,
        excluded: 0,
        limitReached: false,
      },
    ]),
  );
  const detections = new Map<string, FrameworkGraph["detections"][number]>();
  const candidates = new Map<string, FrameworkCandidate>();
  const diagnostics: FrameworkDiagnostic[] = [];

  const evidence = (
    node: ArchitectureNode,
    content: string,
    line: number,
  ): SourceEvidence => ({
    path: node.id,
    line,
    hash: node.hash,
    excerpt: content.split(/\r?\n/)[line - 1]?.trim().slice(0, 300),
  });
  const owner = (file: string, line: number) => {
    const containing = (byFile.get(file) || [])
      .filter(
        (record) =>
          record.symbol.line <= line && record.symbol.endLine >= line,
      )
      .sort(
        (left, right) =>
          left.symbol.endLine - left.symbol.line -
          (right.symbol.endLine - right.symbol.line),
      )[0];
    return containing?.semanticId || semanticFiles.get(file) || null;
  };
  const resolveSymbol = (file: string, name: string) => {
    if (!/^[A-Za-z_]\w*$/.test(name)) return null;
    const local = (byFile.get(file) || []).filter(
      (record) => record.symbol.name === name,
    );
    if (local.length === 1) return local[0];
    const global = byName.get(name) || [];
    return global.length === 1 ? global[0] : null;
  };
  const diagnostic = (
    framework: FrameworkId,
    code: string,
    node: ArchitectureNode,
    content: string,
    line: number,
    message: string,
  ) => {
    coverage.get(framework)!.excluded++;
    if (diagnostics.length >= MAX_DIAGNOSTICS) return;
    diagnostics.push({
      code,
      severity: "warning",
      framework,
      subject: `${node.id}:${line}`,
      message,
      evidence: [evidence(node, content, line)],
    });
  };
  const detect = (
    framework: FrameworkId,
    language: FrameworkLanguage,
    node: ArchitectureNode,
    content: string,
    line: number,
  ) => {
    const key = `${framework}:${node.id}`;
    const current = coverage.get(framework)!;
    current.detected.add(node.id);
    current.analyzed.add(node.id);
    if (detections.has(key)) return;
    detections.set(key, {
      id: `framework:detection:${framework}:${contentHash(node.id).slice(0, 16)}`,
      framework,
      adapterId: adapterId(framework),
      adapterVersion: ADAPTER_VERSION,
      language,
      path: node.id,
      evidence: [evidence(node, content, line)],
    });
  };
  const add = (
    framework: FrameworkId,
    language: FrameworkLanguage,
    ruleId: string,
    kind: FrameworkCandidate["kind"],
    from: string | null,
    to: string | null,
    valueLabel: string,
    itemEvidence: SourceEvidence,
  ) => {
    if (!from || !to) return false;
    const signature = `${framework}:${ruleId}:${kind}:${from}:${to}:${itemEvidence.path}:${itemEvidence.line}:${valueLabel}`;
    const suffix = contentHash(signature).slice(0, 24);
    const id = `framework:candidate:${framework}:${suffix}`;
    if (candidates.has(id)) return true;
    if (candidates.size >= MAX_CANDIDATES) {
      coverage.get(framework)!.limitReached = true;
      return false;
    }
    const candidate: FrameworkCandidate = {
      id,
      relationId: `behavior:framework:${suffix}`,
      framework,
      adapterId: adapterId(framework),
      adapterVersion: ADAPTER_VERSION,
      ruleId,
      language,
      kind,
      from,
      to,
      valueLabel: valueLabel.slice(0, 300),
      trust: "verified",
      confidence: 1,
      evidence: [itemEvidence],
    };
    candidates.set(id, candidate);
    coverage.get(framework)!.candidates++;
    return true;
  };
  const importLine = (content: string, expression: RegExp) => {
    const lines = content.split(/\r?\n/);
    const index = lines.findIndex((line) => expression.test(line));
    return index < 0 ? 0 : index + 1;
  };
  const decoratorEvidence = (
    node: ArchitectureNode,
    content: string,
    symbol: CodeSymbol,
    expression: RegExp,
  ) => {
    const lines = content.split(/\r?\n/);
    for (let line = symbol.line - 1; line >= Math.max(1, symbol.line - 12); line--)
      if (expression.test(lines[line - 1]?.trim() || ""))
        return evidence(node, content, line);
    return evidence(node, content, symbol.line);
  };

  for (const node of input.nodes) {
    if (node.kind !== "file") continue;
    const language = languageFor(node);
    const content = input.contents.get(node.id);
    if (!language || content === undefined) continue;
    const lines = content.split(/\r?\n/);

    if (language === "python") {
      const fastapiLine = importLine(
        content,
        /^\s*(?:from\s+fastapi(?:\.\w+)*\s+import\b|import\s+fastapi\b)/,
      );
      if (fastapiLine) {
        detect("fastapi", language, node, content, fastapiLine);
        const instances = new Set<string>();
        lines.forEach((line) => {
          const match = line.match(
            /^\s*([A-Za-z_]\w*)\s*=\s*(?:(?:fastapi\.)?(?:FastAPI|APIRouter))\s*\(/,
          );
          if (match) instances.add(match[1]);
        });
        for (const record of byFile.get(node.id) || [])
          for (const decorator of record.symbol.decorators || []) {
            const match = decorator.match(
              /^([A-Za-z_]\w*)\.(get|post|put|patch|delete|options|head|websocket)\(\s*(["'])([^"']+)\3/,
            );
            if (match && instances.has(match[1])) {
              const itemEvidence = decoratorEvidence(
                node,
                content,
                record.symbol,
                new RegExp(`^@${match[1]}\\.${match[2]}\\(`),
              );
              add(
                "fastapi",
                language,
                "fastapi.decorator-route.v1",
                "handles",
                semanticFiles.get(node.id) || null,
                record.semanticId,
                `${match[2].toUpperCase()} ${match[4]}`,
                itemEvidence,
              );
            } else {
              const dynamicRoute = decorator.match(
                /^([A-Za-z_]\w*)\.(get|post|put|patch|delete|options|head|websocket)\s*\(/,
              );
              if (dynamicRoute && instances.has(dynamicRoute[1]))
                diagnostic(
                  "fastapi",
                  "FRAMEWORK_DYNAMIC_ROUTE_EXCLUDED",
                  node,
                  content,
                  Math.max(1, record.symbol.line - 1),
                  "FastAPI route decorator uses a dynamic path",
                );
            }
          }
        lines.forEach((lineText, index) => {
          const match = lineText.match(
            /\b([A-Za-z_]\w*)\.add_api_route\(\s*(["'])([^"']+)\2\s*,\s*([A-Za-z_]\w*)\b/,
          );
          if (!match) {
            const dynamic = lineText.match(
              /\b([A-Za-z_]\w*)\.add_api_route\s*\(/,
            );
            if (dynamic && instances.has(dynamic[1]))
              diagnostic(
                "fastapi",
                "FRAMEWORK_DYNAMIC_ROUTE_EXCLUDED",
                node,
                content,
                index + 1,
                "FastAPI add_api_route uses a dynamic path or non-identifier handler",
              );
            return;
          }
          if (!instances.has(match[1])) return;
          const target = resolveSymbol(node.id, match[4]);
          if (!target)
            diagnostic(
              "fastapi",
              "FRAMEWORK_HANDLER_UNRESOLVED",
              node,
              content,
              index + 1,
              `FastAPI handler ${match[4]} is not a unique internal symbol`,
            );
          else
            add(
              "fastapi",
              language,
              "fastapi.add-api-route.v1",
              "handles",
              owner(node.id, index + 1),
              target.semanticId,
              `ROUTE ${match[3]}`,
              evidence(node, content, index + 1),
            );
        });
      }

      const langgraphLine = importLine(
        content,
        /^\s*(?:from\s+langgraph(?:\.\w+)*\s+import\b|import\s+langgraph\b)/,
      );
      if (langgraphLine) {
        detect("langgraph", language, node, content, langgraphLine);
        const graphs = new Set<string>();
        lines.forEach((line) => {
          const match = line.match(
            /^\s*([A-Za-z_]\w*)\s*=\s*(?:StateGraph|langgraph\.graph\.StateGraph)\s*\(/,
          );
          if (match) graphs.add(match[1]);
        });
        const nodesByGraph = new Map<string, Map<string, SymbolRecord>>();
        lines.forEach((lineText, index) => {
          const match = lineText.match(
            /\b([A-Za-z_]\w*)\.add_node\(\s*(["'])([^"']+)\2\s*,\s*([A-Za-z_]\w*)\s*\)/,
          );
          if (!match) {
            const dynamic = lineText.match(/\b([A-Za-z_]\w*)\.add_node\s*\(/);
            if (dynamic && graphs.has(dynamic[1]))
              diagnostic(
                "langgraph",
                "FRAMEWORK_DYNAMIC_NODE_EXCLUDED",
                node,
                content,
                index + 1,
                "LangGraph node uses a dynamic name or non-identifier callback",
              );
            return;
          }
          if (!graphs.has(match[1])) return;
          const target = resolveSymbol(node.id, match[4]);
          if (!target) {
            diagnostic(
              "langgraph",
              "FRAMEWORK_NODE_HANDLER_UNRESOLVED",
              node,
              content,
              index + 1,
              `LangGraph node handler ${match[4]} is not a unique internal symbol`,
            );
            return;
          }
          const callbacks = nodesByGraph.get(match[1]) || new Map();
          callbacks.set(match[3], target);
          nodesByGraph.set(match[1], callbacks);
          add(
            "langgraph",
            language,
            "langgraph.add-node.v1",
            "handles",
            owner(node.id, index + 1),
            target.semanticId,
            `LangGraph node ${match[3]}`,
            evidence(node, content, index + 1),
          );
        });
        lines.forEach((lineText, index) => {
          const match = lineText.match(
            /\b([A-Za-z_]\w*)\.add_edge\(\s*(?:(["'])([^"']+)\2|(START))\s*,\s*(?:(["'])([^"']+)\5|(END))\s*\)/,
          );
          if (!match) {
            const dynamic = lineText.match(/\b([A-Za-z_]\w*)\.add_edge\s*\(/);
            if (dynamic && graphs.has(dynamic[1]))
              diagnostic(
                "langgraph",
                "FRAMEWORK_DYNAMIC_EDGE_EXCLUDED",
                node,
                content,
                index + 1,
                "LangGraph edge uses a dynamic or unsupported endpoint",
              );
            return;
          }
          if (!graphs.has(match[1])) return;
          const callbacks = nodesByGraph.get(match[1]) || new Map();
          const from = match[4]
            ? semanticFiles.get(node.id) || null
            : callbacks.get(match[3])?.semanticId || null;
          const to = match[7]
            ? semanticFiles.get(node.id) || null
            : callbacks.get(match[6])?.semanticId || null;
          if (!from || !to)
            diagnostic(
              "langgraph",
              "FRAMEWORK_EDGE_ENDPOINT_UNRESOLVED",
              node,
              content,
              index + 1,
              "LangGraph edge references a node without a statically resolved add_node callback",
            );
          else
            add(
              "langgraph",
              language,
              "langgraph.add-edge.v1",
              "routes-to",
              from,
              to,
              `LangGraph ${match[4] ? "START" : match[3]} → ${match[7] ? "END" : match[6]}`,
              evidence(node, content, index + 1),
            );
        });
        lines.forEach((lineText, index) => {
          const match = lineText.match(
            /\b([A-Za-z_]\w*)\.add_conditional_edges\(\s*(["'])([^"']+)\2\s*,\s*[A-Za-z_]\w*\s*,\s*\{([^}]+)\}\s*\)/,
          );
          if (!match || !graphs.has(match[1])) return;
          const callbacks = nodesByGraph.get(match[1]) || new Map();
          const from = callbacks.get(match[3])?.semanticId || null;
          const targets = [...match[4].matchAll(/(["'])([^"']+)\1\s*:\s*(["'])([^"']+)\3/g)]
            .map((item) => item[4]);
          if (!from || !targets.length) {
            diagnostic(
              "langgraph",
              "FRAMEWORK_CONDITIONAL_EDGE_EXCLUDED",
              node,
              content,
              index + 1,
              "LangGraph conditional edge does not expose a static source node and route map",
            );
            return;
          }
          let emitted = 0;
          for (const targetName of targets) {
            const to = callbacks.get(targetName)?.semanticId || null;
            if (
              add(
                "langgraph",
                language,
                "langgraph.conditional-edge.v1",
                "routes-to",
                from,
                to,
                `LangGraph conditional ${match[3]} → ${targetName}`,
                evidence(node, content, index + 1),
              )
            )
              emitted++;
          }
          if (emitted !== targets.length)
            diagnostic(
              "langgraph",
              "FRAMEWORK_CONDITIONAL_TARGET_UNRESOLVED",
              node,
              content,
              index + 1,
              "LangGraph conditional map references an unresolved node callback",
            );
        });
      }

      const celeryLine = importLine(
        content,
        /^\s*(?:from\s+celery(?:\.\w+)*\s+import\b|import\s+celery\b)/,
      );
      if (celeryLine) {
        detect("celery", language, node, content, celeryLine);
        const instances = new Set<string>();
        lines.forEach((line) => {
          const match = line.match(
            /^\s*([A-Za-z_]\w*)\s*=\s*(?:Celery|celery\.Celery)\s*\(/,
          );
          if (match) instances.add(match[1]);
        });
        for (const record of byFile.get(node.id) || []) {
          const taskDecorator = (record.symbol.decorators || []).find(
            (decorator) =>
              decorator === "shared_task" ||
              decorator.startsWith("shared_task(") ||
              [...instances].some(
                (name) =>
                  decorator === `${name}.task` ||
                  decorator.startsWith(`${name}.task(`),
              ),
          );
          if (!taskDecorator) continue;
          add(
            "celery",
            language,
            "celery.task-decorator.v1",
            "handles",
            semanticFiles.get(node.id) || null,
            record.semanticId,
            `Celery task ${record.symbol.name}`,
            decoratorEvidence(
              node,
              content,
              record.symbol,
              /^@(shared_task|[A-Za-z_]\w*\.task)\b/,
            ),
          );
        }
        lines.forEach((lineText, index) => {
          const match = lineText.match(
            /\b([A-Za-z_]\w*)\.(delay|apply_async)\s*\(/,
          );
          if (!match) return;
          const target = resolveSymbol(node.id, match[1]);
          if (!target) return;
          add(
            "celery",
            language,
            "celery.enqueue.v1",
            "publishes",
            owner(node.id, index + 1),
            target.semanticId,
            `Celery enqueue ${match[1]}`,
            evidence(node, content, index + 1),
          );
        });
        lines.forEach((lineText, index) => {
          const call = lineText.match(
            /\b([A-Za-z_]\w*)\.(send_task|signature)\(\s*(?:(["'])([^"']+)\3|([^,)]+))/,
          );
          if (!call || !instances.has(call[1])) return;
          if (!call[4]) {
            diagnostic(
              "celery",
              "FRAMEWORK_DYNAMIC_TASK_EXCLUDED",
              node,
              content,
              index + 1,
              "Celery task name is computed dynamically",
            );
            return;
          }
          add(
            "celery",
            language,
            "celery.named-task-publish.v1",
            "publishes",
            owner(node.id, index + 1),
            semanticFiles.get(node.id) || null,
            `Celery named task ${call[4]}`,
            evidence(node, content, index + 1),
          );
        });
      }
    }

    if (language === "typescript" || language === "javascript") {
      const expressLine = importLine(
        content,
        /(?:\bfrom\s+["']express["']|\brequire\(\s*["']express["']\s*\))/,
      );
      if (expressLine) {
        detect("express", language, node, content, expressLine);
        const instances = new Set<string>();
        lines.forEach((line) => {
          const match = line.match(
            /\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:express\s*\(|Router\s*\()/,
          );
          if (match) instances.add(match[1]);
        });
        lines.forEach((lineText, index) => {
          const match = lineText.match(
            /\b([A-Za-z_]\w*)\.(get|post|put|patch|delete|options|head|use)\(\s*(["'])([^"']+)\3\s*,\s*([A-Za-z_]\w*)\b/,
          );
          if (match && instances.has(match[1])) {
            const target = resolveSymbol(node.id, match[5]);
            if (!target)
              diagnostic(
                "express",
                "FRAMEWORK_HANDLER_UNRESOLVED",
                node,
                content,
                index + 1,
                `Express handler ${match[5]} is not a unique internal symbol`,
              );
            else
              add(
                "express",
                language,
                "express.route-registration.v1",
                "handles",
                owner(node.id, index + 1),
                target.semanticId,
                `${match[2].toUpperCase()} ${match[4]}`,
                evidence(node, content, index + 1),
              );
          } else if (
            [...instances].some((name) => lineText.includes(`${name}.`)) &&
            /\.(get|post|put|patch|delete|options|head|use)\s*\(/.test(lineText)
          )
            diagnostic(
              "express",
              "FRAMEWORK_DYNAMIC_ROUTE_EXCLUDED",
              node,
              content,
              index + 1,
              "Express registration uses a dynamic path or non-identifier handler",
            );
        });
      }

      const nestLine = importLine(
        content,
        /\bfrom\s+["']@nestjs\/(?:common|core|microservices)["']/,
      );
      if (nestLine) {
        detect("nestjs", language, node, content, nestLine);
        const classes = (byFile.get(node.id) || []).filter(
          (record) =>
            record.symbol.kind === "class" &&
            (record.symbol.decorators || []).some((item) =>
              /^@?Controller(?:\(|$)/.test(item),
            ),
        );
        for (const controller of classes) {
          const controllerDecorator = (controller.symbol.decorators || []).find(
            (item) => /^@?Controller(?:\(|$)/.test(item),
          )!;
          const prefix =
            controllerDecorator.match(/^@?Controller\(\s*(["'])([^"']+)\1/)?.[2] || "";
          for (const method of (byFile.get(node.id) || []).filter(
            (record) => record.symbol.containerId === controller.symbol.id,
          ))
            for (const decorator of method.symbol.decorators || []) {
              const route = decorator.match(
                /^@?(Get|Post|Put|Patch|Delete|Options|Head|All)\s*(?:\(\s*(["'])([^"']*)\2\s*\)|\(\s*\)|$)/,
              );
              if (route) {
                const suffix = route[3] || "";
                const fullPath = `/${[prefix, suffix]
                  .map((item) => item.replace(/^\/+|\/+$/g, ""))
                  .filter(Boolean)
                  .join("/")}`;
                add(
                  "nestjs",
                  language,
                  "nestjs.controller-route.v1",
                  "handles",
                  controller.semanticId,
                  method.semanticId,
                  `${route[1].toUpperCase()} ${fullPath}`,
                  decoratorEvidence(
                    node,
                    content,
                    method.symbol,
                    new RegExp(`^@${route[1]}\\b`),
                  ),
                );
              } else if (/^@?(Get|Post|Put|Patch|Delete|Options|Head|All)\(/.test(decorator))
                diagnostic(
                  "nestjs",
                  "FRAMEWORK_DYNAMIC_ROUTE_EXCLUDED",
                  node,
                  content,
                  Math.max(1, method.symbol.line - 1),
                  "NestJS route decorator uses a dynamic path",
                );
            }
        }
      }

      const normalizedPath = node.id.replaceAll("\\", "/");
      const nextConvention =
        /(^|\/)app\/(?:.+\/)?route\.[cm]?[jt]sx?$/.test(normalizedPath) ||
        /(^|\/)pages\/api\/.+\.[cm]?[jt]sx?$/.test(normalizedPath);
      const nextLine = importLine(content, /\bfrom\s+["']next(?:\/[^"']*)?["']/);
      const serverAction = /^\s*["']use server["'];?/m.test(content);
      if (nextConvention || nextLine || serverAction) {
        const line = nextLine ||
          Math.max(1, lines.findIndex((item) => /["']use server["']/.test(item)) + 1);
        detect("nextjs", language, node, content, line);
        const httpMethods = new Set([
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "OPTIONS",
          "HEAD",
        ]);
        for (const record of byFile.get(node.id) || []) {
          if (
            /(^|\/)app\//.test(normalizedPath) &&
            /\/route\.[cm]?[jt]sx?$/.test(normalizedPath) &&
            record.symbol.exported &&
            ["function", "method"].includes(record.symbol.kind) &&
            httpMethods.has(record.symbol.name)
          )
            add(
              "nextjs",
              language,
              "nextjs.app-route-export.v1",
              "handles",
              semanticFiles.get(node.id) || null,
              record.semanticId,
              `Next ${record.symbol.name} ${normalizedPath}`,
              evidence(node, content, record.symbol.line),
            );
          if (
            /(^|\/)pages\/api\//.test(normalizedPath) &&
            record.symbol.exported &&
            ["function", "method"].includes(record.symbol.kind)
          )
            add(
              "nextjs",
              language,
              "nextjs.pages-api-export.v1",
              "handles",
              semanticFiles.get(node.id) || null,
              record.semanticId,
              `Next API ${normalizedPath}`,
              evidence(node, content, record.symbol.line),
            );
          if (
            serverAction &&
            record.symbol.exported &&
            record.symbol.async &&
            ["function", "method"].includes(record.symbol.kind)
          )
            add(
              "nextjs",
              language,
              "nextjs.server-action.v1",
              "handles",
              semanticFiles.get(node.id) || null,
              record.semanticId,
              `Next server action ${record.symbol.name}`,
              evidence(node, content, record.symbol.line),
            );
        }
        lines.forEach((lineText, index) => {
          const assignment = lineText.match(
            /^\s*export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*=\s*(.+)$/,
          );
          const explicitArrow = assignment
            ? /^(?:async\s*)?\([^)]*\)\s*=>/.test(assignment[2].trim())
            : false;
          if (assignment && !explicitArrow)
            diagnostic(
              "nextjs",
              "FRAMEWORK_DYNAMIC_HANDLER_EXCLUDED",
              node,
              content,
              index + 1,
              "Next route export is produced dynamically rather than declared as a source function",
            );
        });
      }
    }

    if (language === "rust") {
      const axumLine = importLine(content, /^\s*(?:use\s+axum\b|.*\baxum::)/);
      if (axumLine) {
        detect("axum", language, node, content, axumLine);
        lines.forEach((lineText, index) => {
          const route = lineText.match(
            /\.route\(\s*(["'])([^"']+)\1\s*,\s*(get|post|put|patch|delete|options|head)\(\s*([A-Za-z_]\w*)\s*\)\s*\)/,
          );
          if (route) {
            const target = resolveSymbol(node.id, route[4]);
            if (!target)
              diagnostic(
                "axum",
                "FRAMEWORK_HANDLER_UNRESOLVED",
                node,
                content,
                index + 1,
                `Axum handler ${route[4]} is not a unique internal symbol`,
              );
            else
              add(
                "axum",
                language,
                "axum.router-route.v1",
                "handles",
                owner(node.id, index + 1),
                target.semanticId,
                `${route[3].toUpperCase()} ${route[2]}`,
                evidence(node, content, index + 1),
              );
          } else if (lineText.includes(".route("))
            diagnostic(
              "axum",
              "FRAMEWORK_DYNAMIC_ROUTE_EXCLUDED",
              node,
              content,
              index + 1,
              "Axum route uses a dynamic path, layered handler, or unsupported registration shape",
            );
        });
      }

      const tokioLine = importLine(
        content,
        /^\s*(?:use\s+tokio\b|.*\btokio::|\s*#\[tokio::)/,
      );
      if (tokioLine) {
        detect("tokio", language, node, content, tokioLine);
        const joinSets = new Set<string>();
        lines.forEach((line) => {
          const match = line.match(
            /\blet\s+(?:mut\s+)?([A-Za-z_]\w*)\s*=\s*(?:tokio::task::)?JoinSet::new\s*\(/,
          );
          if (match) joinSets.add(match[1]);
        });
        lines.forEach((lineText, index) => {
          const spawn = lineText.match(
            /\b(?:tokio::(?:task::)?|task::)spawn\(\s*([A-Za-z_]\w*)\s*\(/,
          );
          const join = lineText.match(
            /\b([A-Za-z_]\w*)\.spawn\(\s*([A-Za-z_]\w*)\s*\(/,
          );
          const targetName = spawn?.[1] ||
            (join && joinSets.has(join[1]) ? join[2] : null);
          if (targetName) {
            const target = resolveSymbol(node.id, targetName);
            if (!target)
              diagnostic(
                "tokio",
                "FRAMEWORK_TASK_UNRESOLVED",
                node,
                content,
                index + 1,
                `Tokio task ${targetName} is not a unique internal symbol`,
              );
            else
              add(
                "tokio",
                language,
                join ? "tokio.joinset-spawn.v1" : "tokio.spawn.v1",
                "spawns",
                owner(node.id, index + 1),
                target.semanticId,
                `Tokio spawn ${targetName}`,
                evidence(node, content, index + 1),
              );
          } else if (/\b(?:tokio::(?:task::)?|task::)spawn\s*\(/.test(lineText))
            diagnostic(
              "tokio",
              "FRAMEWORK_DYNAMIC_TASK_EXCLUDED",
              node,
              content,
              index + 1,
              "Tokio spawn uses an async block, macro, or non-identifier task target",
            );
        });
        lines.forEach((lineText, index) => {
          const channel = lineText.match(
            /\blet\s*\(\s*([A-Za-z_]\w*)\s*,\s*(?:mut\s+)?([A-Za-z_]\w*)\s*\)\s*=\s*(?:tokio::sync::)?mpsc::channel(?:(?:::)?<[^>]+>)?\s*\(/,
          );
          if (!channel) return;
          const currentOwner = owner(node.id, index + 1);
          const fileId = semanticFiles.get(node.id) || null;
          if (!currentOwner || !fileId) return;
          const containing = (byFile.get(node.id) || [])
            .filter((record) => record.semanticId === currentOwner)[0];
          const endLine = containing?.symbol.endLine || lines.length;
          for (let cursor = index + 1; cursor < endLine; cursor++) {
            if (new RegExp(`\\b${channel[1]}\\.send\\s*\\(`).test(lines[cursor]))
              add(
                "tokio",
                language,
                "tokio.mpsc-send.v1",
                "publishes",
                currentOwner,
                fileId,
                `Tokio mpsc send ${channel[1]}`,
                evidence(node, content, cursor + 1),
              );
            if (new RegExp(`\\b${channel[2]}\\.recv\\s*\\(`).test(lines[cursor]))
              add(
                "tokio",
                language,
                "tokio.mpsc-recv.v1",
                "subscribes",
                fileId,
                currentOwner,
                `Tokio mpsc receive ${channel[2]}`,
                evidence(node, content, cursor + 1),
              );
          }
        });
      }
    }
  }

  const coverageItems: FrameworkCoverage[] = FRAMEWORKS.map((framework) => {
    const item = coverage.get(framework)!;
    return {
      framework,
      detectedFiles: item.detected.size,
      analyzedFiles: item.analyzed.size,
      candidateCount: item.candidates,
      excludedCount: item.excluded,
      limitReached: item.limitReached,
    };
  });
  if (candidates.size >= MAX_CANDIDATES && diagnostics.length < MAX_DIAGNOSTICS)
    diagnostics.push({
      code: "FRAMEWORK_CANDIDATE_LIMIT_REACHED",
      severity: "warning",
      subject: "document",
      message: `Framework candidates reached the ${MAX_CANDIDATES} source-only analysis limit`,
    });
  const canonical = {
    sourceRevision: input.sourceRevision,
    semanticRevision: input.semantic.revision,
    detections: [...detections.values()].sort((a, b) => a.id.localeCompare(b.id)),
    candidates: [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id)),
    coverage: coverageItems,
    diagnostics,
  };
  const revision = contentHash(JSON.stringify(canonical));
  return finalizeFrameworkGraph(
    {
      schemaVersion: 1,
      contract: "witch.framework/v1",
      analyzerVersion: FRAMEWORK_ANALYZER_VERSION,
      policyVersion: FRAMEWORK_POLICY_VERSION,
      workspaceRoot: input.workspaceRoot,
      revision,
      generatedAt: input.generatedAt,
      ...canonical,
    },
    input.semantic,
    input.nodes,
  );
}
