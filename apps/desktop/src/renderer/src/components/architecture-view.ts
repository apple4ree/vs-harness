import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type {
  ArchitectureGraph,
  ArchitectureNode,
  ComponentContext,
} from "../../../shared/architecture";
import { componentContext } from "../../../shared/architecture";
import type { SourceNeighborhoodProjection } from "../../../shared/architecture-projection";
import type { SemanticNode } from "../../../shared/semantic";
import type { BehaviorRelation } from "../../../shared/behavior";
import type {
  RuntimeObservedRelation,
  RuntimeTraceMode,
} from "../../../shared/runtime-trace";
import {
  emptyVisualQualityReceipt,
  selectReadableBackbone,
  validateVisualGraph,
  type GraphDensity,
  type VisualPoint,
} from "./architecture-visual-quality";

export type { GraphDensity } from "./architecture-visual-quality";

export type ArchitectureScope = "modules" | "files" | "focus" | "semantics";
export type SemanticLens =
  | "overview"
  | "components"
  | "workflows"
  | "calls"
  | "types"
  | "data"
  | "behavior"
  | "frameworks"
  | "questions"
  | "verified";
export type WorkflowViewMode = "graph" | "sequence";
export type WorkflowProjectionOptions = {
  focusId?: string | null;
  componentFocusId?: string | null;
  mode?: WorkflowViewMode;
  collapseBranches?: boolean;
  catalogLimit?: number;
  includeSupport?: boolean;
};
export type RuntimeViewOptions = {
  mode: RuntimeTraceMode;
  observedRelations: RuntimeObservedRelation[];
  matchedStaticIds?: ReadonlySet<string>;
  matchedObservedIds?: ReadonlySet<string>;
};
export type WorkflowCatalogSummary = {
  total: number;
  production: number;
  support: number;
  eligible: number;
  visible: number;
  hidden: number;
  supportHidden: number;
};
export type CardKind =
  | "module"
  | "file"
  | "external"
  | "system"
  | "component"
  | "workflow"
  | "workflow-step"
  | "symbol"
  | "external-system";

export type CardData = {
  label: string;
  subtitle: string;
  paths: string[];
  kind: CardKind;
  count: number;
  symbols: number;
  context: ComponentContext;
  changed: boolean;
  dimmed: boolean;
  traced: boolean;
  semanticId?: string;
  trust?: "verified" | "inferred" | "authored";
  status?: string;
  confidence?: number;
  description?: string;
  questions?: number;
  sequence?: boolean;
  workflowSummary?: {
    steps: number;
    branches: number;
    retries: number;
    support: boolean;
    components: string[];
  };
  behaviorSummary?: {
    inputs: string[];
    outputs: string[];
    sideEffects: string[];
  };
} & Record<string, unknown>;
export type CardNode = Node<CardData, "component">;

export type WorkflowCatalogCardGroup = {
  id: string;
  label: string;
  workflows: CardNode[];
};

export function groupWorkflowCatalogCards(
  nodes: readonly CardNode[],
): WorkflowCatalogCardGroup[] {
  const groups = new Map<string, WorkflowCatalogCardGroup>();
  for (const node of nodes) {
    if (node.data.kind !== "workflow" || !node.data.workflowSummary) continue;
    const label = node.data.workflowSummary.components[0] || "Workspace";
    const id = label.toLowerCase();
    const group = groups.get(id) || { id, label, workflows: [] };
    group.workflows.push(node);
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      workflows: group.workflows.sort(
        (left, right) =>
          Number(Boolean(left.data.workflowSummary?.support)) -
            Number(Boolean(right.data.workflowSummary?.support)) ||
          left.data.label.localeCompare(right.data.label),
      ),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function shouldUseWorkflowCatalogGrid(
  summary: WorkflowCatalogSummary | undefined,
  qualityStatus: "pass" | "warning" | "fail",
  options: { expanded: boolean; includeSupport: boolean },
) {
  if (!summary || summary.eligible === 0) return false;
  return (
    options.expanded ||
    options.includeSupport ||
    summary.eligible > 12 ||
    (summary.visible > 8 && qualityStatus !== "pass")
  );
}

export function workflowCatalogDisplayLabel(
  label: string,
  path: string | undefined,
  duplicateCount: number,
) {
  if (duplicateCount <= 1 || !path) return label;
  const segments = path.split(/[\\/]/).filter(Boolean);
  const filename = segments.at(-1)?.replace(/\.[^.]+$/, "") || "";
  const genericDirectories = new Set([
    "src",
    "lib",
    "app",
    "apps",
    "scripts",
    "script",
    "tests",
    "test",
    "examples",
    "example",
    "workflows",
    ".github",
  ]);
  const scope = segments
    .slice(0, -1)
    .reverse()
    .find((segment) => !genericDirectories.has(segment.toLowerCase()));
  const fallback = !["main", "index", "mod", "lib", "__init__"].includes(
    filename.toLowerCase(),
  )
    ? filename
    : "";
  const qualifier =
    scope && fallback ? `${scope}/${fallback}` : scope || fallback;
  return qualifier ? `${qualifier} · ${label}` : label;
}

export const isSupportWorkflowPath = (value = "") =>
  /(^|\/)(docs?|examples?|samples?|tests?|fixtures?|benchmarks?)(\/|$)|(^|\/)test_[^/]+$/i.test(
    value,
  );
export const isSupportWorkflowNode = (
  node: Pick<SemanticNode, "path" | "evidence">,
) => {
  const paths = [node.path, ...node.evidence.map((item) => item.path)].filter(
    (value): value is string => Boolean(value),
  );
  return paths.length > 0 && paths.every(isSupportWorkflowPath);
};
export const workflowCatalogIdentity = (
  node: Pick<SemanticNode, "label" | "path" | "evidence">,
) => {
  const path =
    node.path ||
    [...new Set(node.evidence.map((item) => item.path))].sort()[0] ||
    "workspace";
  return `${node.label
    .toLowerCase()
    .replace(/\s+workflow$/, "")
    .trim()}\u0000${path.toLowerCase()}`;
};
export const selectWorkflowCatalogNodes = (nodes: readonly SemanticNode[]) => {
  const byIdentity = new Map<string, SemanticNode>();
  const detailScore = (node: SemanticNode) =>
    node.id.startsWith("semantic:workflow:")
      ? 2
      : node.id.startsWith("compose:workflow:")
        ? 1
        : 0;
  for (const node of nodes) {
    if (node.kind !== "workflow") continue;
    const key = workflowCatalogIdentity(node);
    const existing = byIdentity.get(key);
    if (
      !existing ||
      detailScore(node) > detailScore(existing) ||
      (detailScore(node) === detailScore(existing) &&
        node.confidence > existing.confidence)
    )
      byIdentity.set(key, node);
  }
  return [...byIdentity.values()];
};

function arrangeCards(
  nodes: CardNode[],
  edges: Edge[],
  options: {
    rankdir: "LR" | "TB";
    ranksep: number;
    nodesep: number;
    height: (node: CardNode) => number;
    profile: "showcase" | "standard";
  },
) {
  const layout = new dagre.graphlib.Graph({ multigraph: true })
    .setDefaultEdgeLabel(() => ({}))
    .setGraph({
      rankdir: options.rankdir,
      ranksep: options.ranksep,
      nodesep: options.nodesep,
      marginx: 45,
      marginy: 45,
      acyclicer: "greedy",
      ranker: "network-simplex",
    });
  nodes.forEach((node) =>
    layout.setNode(node.id, { width: 222, height: options.height(node) }),
  );
  edges.forEach((edge) =>
    layout.setEdge(edge.source, edge.target, {}, edge.id),
  );
  dagre.layout(layout);
  const routes = new Map<string, VisualPoint[]>();
  nodes.forEach((node) => {
    const position = layout.node(node.id);
    const height = options.height(node);
    node.position = { x: position.x - 111, y: position.y - height / 2 };
  });
  edges.forEach((edge) => {
    const route = layout.edge({
      v: edge.source,
      w: edge.target,
      name: edge.id,
    }) as { points?: VisualPoint[] } | undefined;
    if (route?.points?.length) routes.set(edge.id, route.points);
  });
  const quality = validateVisualGraph(
    nodes.map((node) => ({
      id: node.id,
      position: node.position,
      width: 222,
      height: options.height(node),
    })),
    edges,
    routes,
    options.profile,
  );
  return quality;
}

function arrangeReadableCards(
  nodes: CardNode[],
  edges: Edge[],
  options: Parameters<typeof arrangeCards>[2],
) {
  let current = [...edges];
  let removed = 0;
  let quality = arrangeCards(nodes, current, options);
  for (
    let round = 0;
    round < Math.min(10, edges.length) && quality.status !== "pass";
    round++
  ) {
    const edgeIds = new Set(current.map((edge) => edge.id));
    const offenders = new Set(
      quality.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .flatMap((diagnostic) => diagnostic.subjects)
        .filter((subject) => edgeIds.has(subject)),
    );
    const weakest = current
      .filter((edge) => offenders.has(edge.id))
      .sort(
        (left, right) =>
          Number(left.data?.count || 1) - Number(right.data?.count || 1) ||
          right.id.localeCompare(left.id),
      )[0];
    if (!weakest) break;
    current = current.filter((edge) => edge.id !== weakest.id);
    removed++;
    quality = arrangeCards(nodes, current, options);
  }
  return { edges: current, quality, removed };
}

export function buildView(
  graph: ArchitectureGraph,
  scope: ArchitectureScope,
  module: string | null,
  external: boolean,
  query: string,
  changed: Set<string>,
  projection: SourceNeighborhoodProjection | null = null,
  semanticLens: SemanticLens = "overview",
  workflow: WorkflowProjectionOptions = {},
  density: GraphDensity = "readable",
  runtime?: RuntimeViewOptions,
) {
  if (scope === "semantics")
    return buildSemanticView(
      graph,
      external,
      query,
      changed,
      semanticLens,
      workflow,
      density,
      runtime,
    );
  const projectedIds = new Set(projection?.nodes.map((node) => node.id) || []);
  const candidates = graph.nodes
    .filter(
      (node) =>
        (external || node.kind !== "external") &&
        (!module || node.module === module || node.kind === "external") &&
        (scope !== "focus" || projectedIds.has(node.id)),
    )
    .sort((a, b) => {
      if (scope !== "focus" || !projection) return 0;
      if (a.id === projection.focus.id) return -1;
      if (b.id === projection.focus.id) return 1;
      return a.id.localeCompare(b.id);
    });
  const groups = new Map<string, ArchitectureNode[]>();
  for (const node of candidates) {
    const id =
      scope === "modules" && node.kind !== "external"
        ? `module:${node.module}`
        : node.id;
    const group = groups.get(id);
    if (group) group.push(node);
    else groups.set(id, [node]);
  }
  const visible = [...groups.entries()]
    .filter(
      ([, group]) =>
        scope === "focus" ||
        !query ||
        group.some((node) =>
          `${node.path} ${node.module} ${node.label} ${node.symbols.map((symbol) => symbol.name).join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
    )
    .slice(0, 220);
  const nodes: CardNode[] = visible.map(([id, group]) => {
    const first = group[0];
    const kind = id.startsWith("module:") ? "module" : first.kind;
    const label = kind === "module" ? first.module : first.label;
    const paths = group.flatMap((node) => (node.path ? [node.path] : []));
    return {
      id,
      type: "component",
      position: { x: 0, y: 0 },
      data: {
        label,
        kind,
        paths,
        count: group.length,
        symbols: group.reduce((total, node) => total + node.symbols.length, 0),
        subtitle:
          kind === "module"
            ? paths
                .slice(0, 2)
                .map((path) => path.split("/").at(-1))
                .join(" · ")
            : first.path || first.label,
        context: componentContext(id, label, paths, graph.revision),
        changed: paths.some((path) => changed.has(path)),
        dimmed: false,
        traced: false,
      },
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  const lookup = new Map(graph.nodes.map((node) => [node.id, node]));
  const projectedEdges = new Set(projection?.edgeIds || []);
  const edgesByPair = new Map<string, Edge>();
  for (const relation of graph.edges) {
    if (scope === "focus" && !projectedEdges.has(relation.id)) continue;
    const sourceNode = lookup.get(relation.from),
      targetNode = lookup.get(relation.to);
    if (!sourceNode || !targetNode) continue;
    const source =
      scope === "modules" && sourceNode.kind !== "external"
        ? `module:${sourceNode.module}`
        : sourceNode.id;
    const target =
      scope === "modules" && targetNode.kind !== "external"
        ? `module:${targetNode.module}`
        : targetNode.id;
    if (source === target || !ids.has(source) || !ids.has(target)) continue;
    const id = `${source}→${target}`;
    const previous = edgesByPair.get(id);
    if (previous) {
      previous.data!.count = Number(previous.data!.count) + relation.count;
      previous.label = String(previous.data!.count);
    } else
      edgesByPair.set(id, {
        id,
        source,
        target,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#9579bb" },
        label: String(relation.count),
        data: { count: relation.count },
        style: { stroke: "#78618f", strokeWidth: 1.4 },
        labelStyle: { fill: "#d4c2e9", fontSize: 10 },
        labelBgStyle: { fill: "#21162d" },
      });
  }
  const allEdges = [...edgesByPair.values()]
    .sort(
      (a, b) =>
        Number(b.data?.count) - Number(a.data?.count) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 600);
  const readable =
    density === "readable" && scope !== "focus"
      ? selectReadableBackbone(nodes, allEdges, {
          maxNodes: 12,
          maxEdges: 11,
          maxDegree: 3,
        })
      : {
          nodes,
          edges: allEdges,
          omittedNodes: 0,
          omittedEdges: 0,
        };
  const arranged =
    density === "readable"
      ? arrangeReadableCards(readable.nodes, readable.edges, {
          rankdir: "LR",
          ranksep: 125,
          nodesep: 58,
          height: () => 117,
          profile: "showcase",
        })
      : {
          edges: readable.edges,
          quality: arrangeCards(readable.nodes, readable.edges, {
            rankdir: "LR",
            ranksep: 100,
            nodesep: 45,
            height: () => 117,
            profile: "standard",
          }),
          removed: 0,
        };
  return {
    nodes: readable.nodes,
    edges: arranged.edges,
    total: groups.size,
    totalEdges:
      scope === "focus" && projection
        ? projection.edgeIds.length
        : edgesByPair.size,
    quality: arranged.quality,
    workflowCatalog: undefined,
    projection: {
      density,
      omittedNodes: readable.omittedNodes,
      omittedEdges: readable.omittedEdges + arranged.removed,
      qualityRemovedEdges: arranged.removed,
    },
  };
}

function semanticPaths(graph: ArchitectureGraph, node: SemanticNode) {
  if (node.kind === "system")
    return graph.nodes.flatMap((item) => (item.path ? [item.path] : []));
  if (node.kind === "component")
    return graph.nodes
      .filter((item) => item.module === node.label && item.path)
      .map((item) => item.path!);
  return [...new Set(node.evidence.map((item) => item.path))];
}

export function buildSemanticView(
  graph: ArchitectureGraph,
  external: boolean,
  query: string,
  changed: Set<string>,
  lens: SemanticLens = "overview",
  workflow: WorkflowProjectionOptions = {},
  density: GraphDensity = "complete",
  runtime?: RuntimeViewOptions,
) {
  const semantic = graph.semantic;
  if (!semantic)
    return {
      nodes: [],
      edges: [],
      total: 0,
      totalEdges: 0,
      quality: emptyVisualQualityReceipt(
        density === "readable" ? "showcase" : "standard",
      ),
      workflowCatalog: undefined,
      projection: {
        density,
        omittedNodes: 0,
        omittedEdges: 0,
        qualityRemovedEdges: 0,
      },
    };
  const normalized = query.toLowerCase();
  const staticBehaviorRelations = graph.behavior?.relations || [];
  const behaviorLensRelations: BehaviorRelation[] =
    runtime?.mode === "observed"
      ? runtime.observedRelations
      : runtime?.mode === "compare"
        ? [...staticBehaviorRelations, ...runtime.observedRelations]
        : staticBehaviorRelations;
  const available = semantic.nodes.filter(
    (node) => external || node.kind !== "external-system",
  );
  const semanticById = new Map(available.map((node) => [node.id, node]));
  const componentParentsByFile = new Map<string, string[]>();
  const semanticFilesBySource = new Map(
    available
      .filter((node) => node.kind === "file" && node.sourceNodeId)
      .map((node) => [node.sourceNodeId!, node.id]),
  );
  for (const relation of semantic.relations) {
    if (relation.kind !== "contains") continue;
    if (semanticById.get(relation.from)?.kind !== "component") continue;
    if (semanticById.get(relation.to)?.kind !== "file") continue;
    componentParentsByFile.set(relation.to, [
      ...(componentParentsByFile.get(relation.to) || []),
      relation.from,
    ]);
  }
  const workflowComponents = (workflowId: string) => {
    const ids = new Set<string>();
    const workflowNode = semanticById.get(workflowId);
    const sourceFile = workflowNode?.sourceNodeId
      ? semanticFilesBySource.get(workflowNode.sourceNodeId)
      : undefined;
    if (sourceFile)
      (componentParentsByFile.get(sourceFile) || []).forEach((id) =>
        ids.add(id),
      );
    const steps = new Set(
      semantic.relations
        .filter(
          (relation) =>
            relation.kind === "contains" && relation.from === workflowId,
        )
        .map((relation) => relation.to),
    );
    for (const relation of semantic.relations) {
      if (relation.kind !== "executes" || !steps.has(relation.from)) continue;
      const target = semanticById.get(relation.to);
      if (target?.kind === "component") ids.add(target.id);
      if (target?.kind === "file")
        (componentParentsByFile.get(target.id) || []).forEach((id) =>
          ids.add(id),
        );
    }
    return [...ids]
      .map((id) => semanticById.get(id))
      .filter((node): node is SemanticNode => node?.kind === "component")
      .sort((left, right) => left.label.localeCompare(right.label));
  };
  const catalogMode = lens === "workflows" && !workflow.focusId;
  const rawWorkflowNodes = available.filter((node) => node.kind === "workflow");
  const componentScore = (node: SemanticNode) =>
    node.id.startsWith("semantic:component:")
      ? 2
      : node.id.startsWith("compose:component:")
        ? 1
        : 0;
  const canonicalComponentByLabel = new Map<string, SemanticNode>();
  for (const component of available.filter(
    (node) => node.kind === "component",
  )) {
    const key = component.label.toLowerCase();
    const existing = canonicalComponentByLabel.get(key);
    if (
      !existing ||
      componentScore(component) > componentScore(existing) ||
      (componentScore(component) === componentScore(existing) &&
        component.confidence > existing.confidence)
    )
      canonicalComponentByLabel.set(key, component);
  }
  const workflowComponentCache = new Map(
    rawWorkflowNodes.map((node) => [
      node.id,
      workflowComponents(node.id).map(
        (component) =>
          canonicalComponentByLabel.get(component.label.toLowerCase()) ||
          component,
      ),
    ]),
  );
  const catalogSystem = available
    .filter((node) => node.kind === "system")
    .sort(
      (left, right) =>
        Number(right.id.startsWith("semantic:system:")) -
          Number(left.id.startsWith("semantic:system:")) ||
        right.confidence - left.confidence ||
        left.id.localeCompare(right.id),
    )[0];
  const allWorkflowNodes = selectWorkflowCatalogNodes(rawWorkflowNodes);
  const matchesCatalogQuery = (node: SemanticNode) =>
    !normalized ||
    `${node.label} ${node.description || ""} ${node.path || ""} ${(workflowComponentCache.get(node.id) || []).map((component) => component.label).join(" ")}`
      .toLowerCase()
      .includes(normalized);
  const productionWorkflows = allWorkflowNodes.filter(
    (node) => !isSupportWorkflowNode(node),
  );
  const supportWorkflows = allWorkflowNodes.filter((node) =>
    isSupportWorkflowNode(node),
  );
  const catalogEligible = (
    workflow.includeSupport ? allWorkflowNodes : productionWorkflows
  )
    .filter(matchesCatalogQuery)
    .sort((left, right) => {
      const leftComponent =
        workflowComponentCache.get(left.id)?.[0]?.label || "";
      const rightComponent =
        workflowComponentCache.get(right.id)?.[0]?.label || "";
      return (
        Number(isSupportWorkflowNode(left)) -
          Number(isSupportWorkflowNode(right)) ||
        leftComponent.localeCompare(rightComponent) ||
        right.confidence - left.confidence ||
        left.label.localeCompare(right.label)
      );
    });
  const catalogLimit = Math.max(1, Math.min(200, workflow.catalogLimit || 12));
  const catalogWorkflows = catalogMode
    ? catalogEligible.slice(0, catalogLimit)
    : [];
  const catalogComponentIds = new Set(
    catalogWorkflows.flatMap((node) =>
      (workflowComponentCache.get(node.id) || [])
        .slice(0, 1)
        .map((item) => item.id),
    ),
  );
  const workflowCatalog: WorkflowCatalogSummary | undefined = catalogMode
    ? {
        total: allWorkflowNodes.length,
        production: productionWorkflows.length,
        support: supportWorkflows.length,
        eligible: catalogEligible.length,
        visible: catalogWorkflows.length,
        hidden: Math.max(0, catalogEligible.length - catalogWorkflows.length),
        supportHidden: workflow.includeSupport ? 0 : supportWorkflows.length,
      }
    : undefined;
  const allowed = new Set<string>();
  if (lens === "overview")
    available
      .filter((node) =>
        ["system", "component", "workflow", "workflow-step"].includes(
          node.kind,
        ),
      )
      .forEach((node) => allowed.add(node.id));
  if (lens === "components") {
    const focus = available.find(
      (node) =>
        node.kind === "component" && node.id === workflow.componentFocusId,
    );
    if (focus) {
      allowed.add(focus.id);
      available
        .filter((node) => node.kind === "system")
        .forEach((node) => allowed.add(node.id));
      semantic.relations
        .filter(
          (relation) =>
            relation.kind === "contains" && relation.from === focus.id,
        )
        .forEach((relation) => allowed.add(relation.to));
    } else
      available
        .filter((node) => ["system", "component", "file"].includes(node.kind))
        .forEach((node) => allowed.add(node.id));
  }
  if (lens === "workflows") {
    const focus = available.find(
      (node) => node.kind === "workflow" && node.id === workflow.focusId,
    );
    if (focus) {
      allowed.add(focus.id);
      const children = semantic.relations
        .filter(
          (relation) =>
            relation.kind === "contains" && relation.from === focus.id,
        )
        .map((relation) => relation.to);
      children.forEach((id) => allowed.add(id));
      if (workflow.mode !== "sequence")
        for (const relation of semantic.relations)
          if (allowed.has(relation.from) && relation.kind === "executes")
            allowed.add(relation.to);
    } else {
      available
        .filter(
          (node) =>
            (catalogWorkflows.length > 0 && node.id === catalogSystem?.id) ||
            catalogComponentIds.has(node.id),
        )
        .forEach((node) => allowed.add(node.id));
      catalogWorkflows.forEach((node) => allowed.add(node.id));
    }
  }
  if (lens === "calls")
    semantic.relations
      .filter((relation) => relation.kind === "calls")
      .forEach((relation) => {
        allowed.add(relation.from);
        allowed.add(relation.to);
      });
  if (lens === "types")
    semantic.relations
      .filter((relation) =>
        ["extends", "implements", "overrides"].includes(relation.kind),
      )
      .forEach((relation) => {
        allowed.add(relation.from);
        allowed.add(relation.to);
      });
  if (lens === "data")
    semantic.relations
      .filter((relation) => ["reads", "writes"].includes(relation.kind))
      .forEach((relation) => {
        allowed.add(relation.from);
        allowed.add(relation.to);
      });
  if (lens === "behavior")
    behaviorLensRelations.forEach((relation) => {
      allowed.add(relation.from);
      allowed.add(relation.to);
    });
  if (lens === "frameworks")
    (graph.behavior?.relations || [])
      .filter((relation) => relation.provenance.framework)
      .forEach((relation) => {
        allowed.add(relation.from);
        allowed.add(relation.to);
      });
  if (lens === "questions") {
    semantic.questions
      .filter((question) => question.status === "open")
      .forEach((question) => allowed.add(question.subjectId));
    for (const relation of semantic.relations)
      if (allowed.has(relation.from) || allowed.has(relation.to)) {
        allowed.add(relation.from);
        allowed.add(relation.to);
      }
  }
  if (lens === "verified") {
    available
      .filter((node) => node.trust !== "inferred")
      .forEach((node) => allowed.add(node.id));
    semantic.claims
      .filter((claim) => claim.trust === "authored")
      .forEach((claim) => allowed.add(claim.subjectId));
  }
  const hiddenBranches = new Set<string>();
  const collapsedByGuard = new Map<string, number>();
  const collapsedContinuations: Array<{ from: string; to: string }> = [];
  if (lens === "workflows" && workflow.collapseBranches) {
    const precedence = new Map<string, string[]>();
    for (const relation of semantic.relations)
      if (
        relation.kind === "precedes" &&
        allowed.has(relation.to) &&
        !relation.description?.includes("branch convergence")
      )
        precedence.set(relation.from, [
          ...(precedence.get(relation.from) || []),
          relation.to,
        ]);
    const branchStarts = new Map<string, string[]>();
    for (const relation of semantic.relations)
      if (
        relation.kind === "branches-to" &&
        allowed.has(relation.from) &&
        allowed.has(relation.to)
      )
        branchStarts.set(relation.from, [
          ...(branchStarts.get(relation.from) || []),
          relation.to,
        ]);
    for (const [guard, rawStarts] of branchStarts) {
      const starts = [...new Set(rawStarts)];
      const paths = starts.map((start) => {
        const reached = new Set<string>();
        const queue = [start];
        while (queue.length && reached.size < 100) {
          const id = queue.shift()!;
          if (reached.has(id) || !allowed.has(id)) continue;
          reached.add(id);
          queue.push(...(precedence.get(id) || []));
        }
        return reached;
      });
      const frequency = new Map<string, number>();
      for (const reached of paths)
        for (const id of reached)
          frequency.set(id, (frequency.get(id) || 0) + 1);
      let count = 0;
      const hiddenForGuard = new Set<string>();
      for (const [id, occurrences] of frequency)
        if (starts.length === 1 || occurrences < starts.length) {
          hiddenBranches.add(id);
          hiddenForGuard.add(id);
          count++;
        }
      if (count) collapsedByGuard.set(guard, count);
      for (const relation of semantic.relations)
        if (
          relation.kind === "precedes" &&
          relation.description?.includes("branch convergence") &&
          hiddenForGuard.has(relation.from) &&
          allowed.has(relation.to) &&
          !hiddenForGuard.has(relation.to)
        )
          collapsedContinuations.push({ from: guard, to: relation.to });
    }
  }
  const candidates = available.filter(
    (node) =>
      allowed.has(node.id) &&
      !hiddenBranches.has(node.id) &&
      (catalogMode ||
        !normalized ||
        `${node.label} ${node.kind} ${node.description || ""} ${node.path || ""}`
          .toLowerCase()
          .includes(normalized)),
  );
  // The workflow catalog is rendered as a scrollable grouped view once it is
  // large. Do not silently drop cards there; the ordinary graph still keeps
  // its defensive node cap for ReactFlow readability.
  const preferred = catalogMode ? candidates : candidates.slice(0, 220);
  const visible = new Set(preferred.map((node) => node.id));
  const workflowSummaries = new Map(
    catalogWorkflows.map((workflowNode) => {
      const steps = new Set(
        semantic.relations
          .filter(
            (relation) =>
              relation.kind === "contains" && relation.from === workflowNode.id,
          )
          .map((relation) => relation.to),
      );
      const withinWorkflow = (id: string) =>
        steps.has(id) || id === workflowNode.id;
      return [
        workflowNode.id,
        {
          steps: steps.size,
          branches: semantic.relations.filter(
            (relation) =>
              relation.kind === "branches-to" &&
              withinWorkflow(relation.from) &&
              withinWorkflow(relation.to),
          ).length,
          retries: semantic.relations.filter(
            (relation) =>
              relation.kind === "retries" &&
              withinWorkflow(relation.from) &&
              withinWorkflow(relation.to),
          ).length,
          support: isSupportWorkflowNode(workflowNode),
          components: (workflowComponentCache.get(workflowNode.id) || []).map(
            (component) => component.label,
          ),
        },
      ] as const;
    }),
  );
  const catalogWorkflowLabelCounts = new Map<string, number>();
  for (const workflowNode of catalogWorkflows) {
    const key = workflowNode.label.toLowerCase();
    catalogWorkflowLabelCounts.set(
      key,
      (catalogWorkflowLabelCounts.get(key) || 0) + 1,
    );
  }
  const catalogComponentCounts = new Map<string, number>();
  for (const workflowNode of catalogWorkflows) {
    const component = workflowComponentCache.get(workflowNode.id)?.[0];
    if (component)
      catalogComponentCounts.set(
        component.id,
        (catalogComponentCounts.get(component.id) || 0) + 1,
      );
  }
  const nodes: CardNode[] = preferred.map((node) => {
    const paths = semanticPaths(graph, node);
    const workflowSummary = workflowSummaries.get(node.id);
    const behaviorSummary = graph.behavior?.workflows.find(
      (summary) => summary.workflowId === node.id,
    );
    const catalogComponentCount = catalogComponentCounts.get(node.id);
    return {
      id: node.id,
      type: "component",
      position: { x: 0, y: 0 },
      data: {
        label: workflowSummary
          ? workflowCatalogDisplayLabel(
              node.label,
              node.path || node.evidence[0]?.path,
              catalogWorkflowLabelCounts.get(node.label.toLowerCase()) || 1,
            )
          : node.label,
        subtitle: workflowSummary
          ? `${workflowSummary.components.join(" · ") || "Workspace"} · ${workflowSummary.support ? "support" : "production"}`
          : catalogComponentCount
            ? `${catalogComponentCount} visible workflow${catalogComponentCount === 1 ? "" : "s"}`
            : catalogMode && node.kind === "system" && workflowCatalog
              ? `${workflowCatalog.visible}/${workflowCatalog.eligible} eligible workflows visible`
              : collapsedByGuard.has(node.id)
                ? `${node.description || node.path || node.kind} · ${collapsedByGuard.get(node.id)} branch step${collapsedByGuard.get(node.id) === 1 ? "" : "s"} collapsed`
                : node.description || node.path || node.kind,
        paths,
        kind: node.kind as CardKind,
        count: semantic.relations.filter(
          (relation) => relation.from === node.id || relation.to === node.id,
        ).length,
        symbols: node.kind === "symbol" ? 1 : 0,
        context: componentContext(
          node.id,
          node.label,
          paths,
          graph.revision,
          node.evidence[0]?.line,
          {
            kind: node.kind,
            trust: node.trust,
            status: node.status,
            confidence: node.confidence,
          },
        ),
        changed: paths.some((path) => changed.has(path)),
        dimmed: false,
        traced: false,
        semanticId: node.id,
        trust: node.trust,
        status: node.status,
        confidence: node.confidence,
        description: node.description,
        questions: semantic.questions.filter(
          (question) =>
            question.subjectId === node.id && question.status === "open",
        ).length,
        sequence: lens === "workflows" && workflow.mode === "sequence",
        workflowSummary,
        ...(behaviorSummary
          ? {
              behaviorSummary: {
                inputs: behaviorSummary.inputs,
                outputs: behaviorSummary.outputs,
                sideEffects: behaviorSummary.sideEffects,
              },
            }
          : {}),
      },
    };
  });
  const trustColor = {
    verified: "#78ba9a",
    inferred: "#a477d3",
    authored: "#c6a56b",
    observed: "#62b5d8",
  };
  const relevantRelations = (
    lens === "behavior"
      ? behaviorLensRelations
      : lens === "frameworks"
        ? staticBehaviorRelations
        : semantic.relations
  ).filter((relation) => {
    if (catalogMode) return false;
    if (!visible.has(relation.from) || !visible.has(relation.to)) return false;
    if (lens === "types")
      return ["extends", "implements", "overrides"].includes(relation.kind);
    if (lens === "data") return ["reads", "writes"].includes(relation.kind);
    if (lens === "behavior") return true;
    if (lens === "frameworks")
      return (
        "framework" in relation.provenance &&
        Boolean(relation.provenance.framework)
      );
    if (lens !== "workflows" || workflow.mode !== "sequence") return true;
    if (["precedes", "branches-to", "retries"].includes(relation.kind))
      return true;
    return (
      relation.kind === "contains" &&
      relation.from === workflow.focusId &&
      relation.to.endsWith(":step")
    );
  });
  const relationEdges: Edge[] = relevantRelations
    .slice(0, 600)
    .map((relation) => {
      const observed = relation.trust === "observed";
      const matched = observed
        ? runtime?.matchedObservedIds?.has(relation.id)
        : runtime?.matchedStaticIds?.has(relation.id);
      return {
        id: relation.id,
        source: relation.from,
        target: relation.to,
        type: "smoothstep",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: trustColor[relation.trust],
        },
        label: relation.kind,
        data: {
          count: 1,
          semantic: true,
          ...(lens === "behavior" || lens === "frameworks"
            ? { behavior: true }
            : {}),
          ...(lens === "frameworks" ? { framework: true } : {}),
          ...(observed ? { observed: true } : {}),
          ...(matched ? { matched: true } : {}),
        },
        style: {
          stroke: trustColor[relation.trust],
          strokeWidth:
            relation.status === "conflicting" || matched ? 2.2 : 1.35,
          strokeDasharray: observed
            ? "2 3"
            : relation.trust === "inferred"
              ? "5 4"
              : undefined,
        },
        labelStyle: { fill: "#d4c2e9", fontSize: 9 },
        labelBgStyle: { fill: "#21162d" },
      };
    });
  const projectionEdges: Edge[] = [
    ...new Map(
      collapsedContinuations.map((continuation) => [
        `${continuation.from}:${continuation.to}`,
        continuation,
      ]),
    ).values(),
  ]
    .filter(
      (continuation) =>
        visible.has(continuation.from) && visible.has(continuation.to),
    )
    .map((continuation) => ({
      id: `projection:collapsed:${continuation.from}:${continuation.to}`,
      source: continuation.from,
      target: continuation.to,
      type: "smoothstep",
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#8f6cac" },
      label: "precedes",
      data: { count: 1, semantic: true, projection: "collapsed-branch" },
      style: { stroke: "#8f6cac", strokeWidth: 1.2, strokeDasharray: "2 5" },
      labelStyle: { fill: "#b69aca", fontSize: 9 },
      labelBgStyle: { fill: "#21162d" },
    }));
  const catalogEdges: Edge[] = catalogMode
    ? [
        ...[...catalogComponentIds]
          .filter((id) => visible.has(id))
          .map((id) => ({
            id: `projection:workflow-catalog:system:${id}`,
            source: catalogSystem?.id || id,
            target: id,
            type: "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed, color: "#8f6cac" },
            label: "component",
            data: {
              count: catalogComponentCounts.get(id) || 1,
              projection: "workflow-catalog",
            },
            style: { stroke: "#8f6cac", strokeWidth: 1.3 },
            labelStyle: { fill: "#d4c2e9", fontSize: 9 },
            labelBgStyle: { fill: "#21162d" },
          })),
        ...catalogWorkflows
          .filter((node) => visible.has(node.id))
          .map((node) => {
            const component = workflowComponentCache.get(node.id)?.[0];
            return {
              id: `projection:workflow-catalog:${component?.id || "system"}:${node.id}`,
              source: component?.id || catalogSystem?.id || node.id,
              target: node.id,
              type: "smoothstep",
              markerEnd: { type: MarkerType.ArrowClosed, color: "#a477d3" },
              label: "workflow",
              data: { count: 1, projection: "workflow-catalog" },
              style: {
                stroke: "#a477d3",
                strokeWidth: 1.3,
                strokeDasharray: "5 4",
              },
              labelStyle: { fill: "#d4c2e9", fontSize: 9 },
              labelBgStyle: { fill: "#21162d" },
            } satisfies Edge;
          }),
      ]
    : [];
  const allEdges = [...relationEdges, ...projectionEdges, ...catalogEdges];
  const shouldProject = density === "readable" && lens !== "workflows";
  const readable = shouldProject
    ? selectReadableBackbone(nodes, allEdges, {
        maxNodes: 12,
        maxEdges: 11,
        maxDegree: 3,
        nodeScore: (node) =>
          Number(node.data.confidence || 0) * 100 +
          Number(node.data.count || 0) * 8 +
          Number(node.data.trust === "verified") * 30 +
          Number(node.data.trust === "authored") * 18,
      })
    : {
        nodes,
        edges: allEdges,
        omittedNodes: 0,
        omittedEdges: 0,
      };
  const sequence = lens === "workflows" && workflow.mode === "sequence";
  const arrangeOptions = {
    rankdir: sequence ? ("TB" as const) : ("LR" as const),
    ranksep: sequence ? 36 : density === "readable" ? 125 : 110,
    nodesep: sequence ? 38 : density === "readable" ? 58 : 52,
    height: () => (sequence ? 92 : 132),
    profile:
      density === "readable" ? ("showcase" as const) : ("standard" as const),
  };
  const arranged =
    density === "readable"
      ? arrangeReadableCards(readable.nodes, readable.edges, arrangeOptions)
      : {
          edges: readable.edges,
          quality: arrangeCards(readable.nodes, readable.edges, arrangeOptions),
          removed: 0,
        };
  return {
    nodes: readable.nodes,
    edges: arranged.edges,
    total: candidates.length,
    totalEdges: relevantRelations.length + projectionEdges.length,
    quality: arranged.quality,
    workflowCatalog,
    projection: {
      density,
      omittedNodes:
        readable.omittedNodes +
        (workflowCatalog?.hidden || 0) +
        (workflowCatalog?.supportHidden || 0),
      omittedEdges: readable.omittedEdges + arranged.removed,
      qualityRemovedEdges: arranged.removed,
    },
  };
}

export function relationsForEdge(
  graph: ArchitectureGraph,
  edge: Pick<Edge, "source" | "target">,
) {
  const matches = (node: ArchitectureNode, id: string) =>
    id.startsWith("module:") ? node.module === id.slice(7) : node.id === id;
  const sources = new Set(
    graph.nodes
      .filter((node) => matches(node, edge.source))
      .map((node) => node.id),
  );
  const targets = new Set(
    graph.nodes
      .filter((node) => matches(node, edge.target))
      .map((node) => node.id),
  );
  return graph.edges.filter(
    (relation) => sources.has(relation.from) && targets.has(relation.to),
  );
}
