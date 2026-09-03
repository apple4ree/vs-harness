/**
 * Witch visual-quality projection.
 *
 * The fail-closed showcase profile, sparse backbone policy, and geometry
 * vocabulary are informed by tt-a1i/archify (MIT). This is an independent
 * implementation over Witch's source-grounded graph rather than an embedded
 * Archify runtime.
 */

export type GraphDensity = "readable" | "complete";
export type VisualPoint = { x: number; y: number };
export type VisualNode = {
  id: string;
  position: VisualPoint;
  width?: number;
  height?: number;
  data?: Record<string, unknown>;
};
export type VisualEdge = {
  id: string;
  source: string;
  target: string;
  label?: unknown;
  data?: Record<string, unknown>;
};
export type VisualQualityCode =
  | "layout/node-overlap"
  | "clean-flow/edge-through-node"
  | "composition/proper-crossing"
  | "composition/ambiguous-corridor"
  | "composition/micro-segment"
  | "composition/short-interior-segment"
  | "composition/density"
  | "composition/label-route-clearance"
  | "composition/boundary-border-run"
  | "composition/projected-text-readability"
  | "render/viewport-overflow";
export type VisualQualitySubject = {
  nodes: string[];
  edges: string[];
  elements: string[];
};
export type VisualQualityDiagnostic = {
  code: VisualQualityCode;
  severity: "error" | "warning";
  message: string;
  subjects: string[];
  subject: VisualQualitySubject;
  evidence: Record<string, string | number | boolean | null>;
  supportedFixes: string[];
};
export type VisualQualityReceipt = {
  contract: "witch.visual-quality/v1";
  profile: "showcase" | "standard";
  status: "pass" | "warning" | "fail";
  nodeCount: number;
  edgeCount: number;
  errors: number;
  warnings: number;
  metrics: {
    nodeOverlaps: number;
    edgeThroughNodes: number;
    properCrossings: number;
    ambiguousCorridors: number;
    microSegments: number;
    shortInteriorSegments: number;
    labelRouteClearanceIssues: number;
    boundaryBorderRuns: number;
    projectedTextIssues: number;
    viewportOverflow: number;
    minProjectedTextPx: number | null;
  };
  diagnostics: VisualQualityDiagnostic[];
};

export type VisualQualityValidationOptions = {
  labels?: Array<{ id: string; edgeId?: string; rect: Omit<Rect, "id"> }>;
  boundaries?: Array<{ id: string; rect: Omit<Rect, "id"> }>;
  projectedText?: Array<{ id: string; pixels: number }>;
  viewport?: { overflowX: number; overflowY: number };
  minimumTextPx?: number;
  checkRouteRhythm?: boolean;
};

type BackboneOptions<TNode extends VisualNode, TEdge extends VisualEdge> = {
  maxNodes?: number;
  maxEdges?: number;
  maxDegree?: number;
  nodeScore?: (node: TNode) => number;
  edgeWeight?: (edge: TEdge) => number;
};

const numeric = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function selectReadableBackbone<
  TNode extends VisualNode,
  TEdge extends VisualEdge,
>(nodes: TNode[], edges: TEdge[], options: BackboneOptions<TNode, TEdge> = {}) {
  const maxNodes = Math.max(1, options.maxNodes ?? 12);
  const maxEdges = Math.max(0, options.maxEdges ?? maxNodes - 1);
  const maxDegree = Math.max(1, options.maxDegree ?? 3);
  if (nodes.length <= maxNodes && edges.length <= maxEdges)
    return {
      nodes,
      edges,
      omittedNodes: 0,
      omittedEdges: 0,
    };

  const known = new Set(nodes.map((node) => node.id));
  const edgeWeight = (edge: TEdge) =>
    options.edgeWeight?.(edge) ?? numeric(edge.data?.count, 1);
  const weightedDegree = new Map(nodes.map((node) => [node.id, 0]));
  const rankedEdges = edges
    .filter((edge) => known.has(edge.source) && known.has(edge.target))
    .sort(
      (left, right) =>
        edgeWeight(right) - edgeWeight(left) || left.id.localeCompare(right.id),
    );
  for (const edge of rankedEdges) {
    const weight = Math.max(1, edgeWeight(edge));
    weightedDegree.set(edge.source, weightedDegree.get(edge.source)! + weight);
    weightedDegree.set(edge.target, weightedDegree.get(edge.target)! + weight);
  }
  const nodeScore = (node: TNode) =>
    options.nodeScore?.(node) ??
    weightedDegree.get(node.id)! * 16 +
      numeric(node.data?.count) * 3 +
      numeric(node.data?.symbols);
  const rankedNodes = [...nodes].sort(
    (left, right) =>
      nodeScore(right) - nodeScore(left) || left.id.localeCompare(right.id),
  );
  const selectedIds = new Set<string>();
  for (const edge of rankedEdges) {
    const additions =
      Number(!selectedIds.has(edge.source)) +
      Number(!selectedIds.has(edge.target));
    if (selectedIds.size + additions > maxNodes) continue;
    selectedIds.add(edge.source);
    selectedIds.add(edge.target);
    if (selectedIds.size === maxNodes) break;
  }
  for (const node of rankedNodes) {
    if (selectedIds.size >= maxNodes) break;
    selectedIds.add(node.id);
  }

  const selectedNodes = rankedNodes.filter((node) => selectedIds.has(node.id));
  const parent = new Map(selectedNodes.map((node) => [node.id, node.id]));
  const degree = new Map(selectedNodes.map((node) => [node.id, 0]));
  const find = (id: string): string => {
    const current = parent.get(id)!;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const usedPairs = new Set<string>();
  const selectedEdges: TEdge[] = [];
  for (const edge of rankedEdges) {
    if (selectedEdges.length >= maxEdges) break;
    if (!selectedIds.has(edge.source) || !selectedIds.has(edge.target))
      continue;
    const pair = [edge.source, edge.target].sort().join("\u0000");
    if (usedPairs.has(pair)) continue;
    const sourceRoot = find(edge.source);
    const targetRoot = find(edge.target);
    if (sourceRoot === targetRoot) continue;
    if (degree.get(edge.source)! >= maxDegree) continue;
    if (degree.get(edge.target)! >= maxDegree) continue;
    selectedEdges.push(edge);
    usedPairs.add(pair);
    degree.set(edge.source, degree.get(edge.source)! + 1);
    degree.set(edge.target, degree.get(edge.target)! + 1);
    parent.set(targetRoot, sourceRoot);
  }
  return {
    nodes: selectedNodes,
    edges: selectedEdges,
    omittedNodes: Math.max(0, nodes.length - selectedNodes.length),
    omittedEdges: Math.max(0, edges.length - selectedEdges.length),
  };
}

type Segment = { from: VisualPoint; to: VisualPoint; edge: VisualEdge };
type Rect = {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const supportedFixes: Record<VisualQualityCode, string[]> = {
  "layout/node-overlap": ["increase-node-separation", "change-rank-direction"],
  "clean-flow/edge-through-node": ["reroute-edge", "increase-rank-separation"],
  "composition/proper-crossing": ["reroute-edge", "reduce-visible-backbone"],
  "composition/ambiguous-corridor": ["separate-parallel-routes", "bundle-related-edges"],
  "composition/micro-segment": ["simplify-route", "increase-node-separation"],
  "composition/short-interior-segment": ["simplify-route", "increase-rank-separation"],
  "composition/density": ["switch-to-readable-backbone", "focus-subgraph"],
  "composition/label-route-clearance": ["move-edge-label", "reroute-edge"],
  "composition/boundary-border-run": ["offset-route-from-boundary", "reroute-edge"],
  "composition/projected-text-readability": ["increase-zoom", "reduce-visible-backbone"],
  "render/viewport-overflow": ["fit-view", "collapse-side-panels"],
};

const EPSILON = 0.5;
const length = (segment: Segment) =>
  Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
const cross = (a: VisualPoint, b: VisualPoint, c: VisualPoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const sharesEndpoint = (left: VisualEdge, right: VisualEdge) =>
  left.source === right.source ||
  left.source === right.target ||
  left.target === right.source ||
  left.target === right.target;

function properIntersection(left: Segment, right: Segment) {
  const d1 = cross(left.from, left.to, right.from);
  const d2 = cross(left.from, left.to, right.to);
  const d3 = cross(right.from, right.to, left.from);
  const d4 = cross(right.from, right.to, left.to);
  return (
    ((d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON)) &&
    ((d3 > EPSILON && d4 < -EPSILON) || (d3 < -EPSILON && d4 > EPSILON))
  );
}

function collinearOverlap(left: Segment, right: Segment) {
  const leftHorizontal = Math.abs(left.from.y - left.to.y) <= EPSILON;
  const rightHorizontal = Math.abs(right.from.y - right.to.y) <= EPSILON;
  if (
    leftHorizontal &&
    rightHorizontal &&
    Math.abs(left.from.y - right.from.y) <= EPSILON
  ) {
    return Math.max(
      0,
      Math.min(
        Math.max(left.from.x, left.to.x),
        Math.max(right.from.x, right.to.x),
      ) -
        Math.max(
          Math.min(left.from.x, left.to.x),
          Math.min(right.from.x, right.to.x),
        ),
    );
  }
  const leftVertical = Math.abs(left.from.x - left.to.x) <= EPSILON;
  const rightVertical = Math.abs(right.from.x - right.to.x) <= EPSILON;
  if (
    leftVertical &&
    rightVertical &&
    Math.abs(left.from.x - right.from.x) <= EPSILON
  ) {
    return Math.max(
      0,
      Math.min(
        Math.max(left.from.y, left.to.y),
        Math.max(right.from.y, right.to.y),
      ) -
        Math.max(
          Math.min(left.from.y, left.to.y),
          Math.min(right.from.y, right.to.y),
        ),
    );
  }
  return 0;
}

const pointInRect = (point: VisualPoint, rect: Rect) =>
  point.x >= rect.left &&
  point.x <= rect.right &&
  point.y >= rect.top &&
  point.y <= rect.bottom;

function segmentIntersectsRect(segment: Segment, rect: Rect) {
  if (pointInRect(segment.from, rect) || pointInRect(segment.to, rect))
    return true;
  const corners: VisualPoint[] = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  for (let index = 0; index < corners.length; index++)
    if (
      properIntersection(segment, {
        from: corners[index],
        to: corners[(index + 1) % corners.length],
        edge: segment.edge,
      })
    )
      return true;
  return false;
}

function borderRun(segment: Segment, rect: Rect) {
  const horizontal = Math.abs(segment.from.y - segment.to.y) <= EPSILON;
  if (
    horizontal &&
    (Math.abs(segment.from.y - rect.top) <= EPSILON ||
      Math.abs(segment.from.y - rect.bottom) <= EPSILON)
  )
    return Math.max(
      0,
      Math.min(Math.max(segment.from.x, segment.to.x), rect.right) -
        Math.max(Math.min(segment.from.x, segment.to.x), rect.left),
    );
  const vertical = Math.abs(segment.from.x - segment.to.x) <= EPSILON;
  if (
    vertical &&
    (Math.abs(segment.from.x - rect.left) <= EPSILON ||
      Math.abs(segment.from.x - rect.right) <= EPSILON)
  )
    return Math.max(
      0,
      Math.min(Math.max(segment.from.y, segment.to.y), rect.bottom) -
        Math.max(Math.min(segment.from.y, segment.to.y), rect.top),
    );
  return 0;
}

function fallbackRoute(edge: VisualEdge, nodes: Map<string, VisualNode>) {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!source || !target) return [];
  const from = {
    x: source.position.x + (source.width || 0),
    y: source.position.y + (source.height || 0) / 2,
  };
  const to = {
    x: target.position.x,
    y: target.position.y + (target.height || 0) / 2,
  };
  const middle = (from.x + to.x) / 2;
  return [from, { x: middle, y: from.y }, { x: middle, y: to.y }, to];
}

export function validateVisualGraph(
  nodes: VisualNode[],
  edges: VisualEdge[],
  routes: ReadonlyMap<string, VisualPoint[]> = new Map(),
  profile: VisualQualityReceipt["profile"] = "showcase",
  options: VisualQualityValidationOptions = {},
) {
  const diagnostics: VisualQualityDiagnostic[] = [];
  const push = (
    diagnostic: Omit<
      VisualQualityDiagnostic,
      "subject" | "evidence" | "supportedFixes"
    > & {
      subject?: Partial<VisualQualitySubject>;
      evidence?: VisualQualityDiagnostic["evidence"];
      supportedFixes?: string[];
    },
  ) => {
    if (diagnostics.length >= 50) return;
    diagnostics.push({
      ...diagnostic,
      subject: {
        nodes: diagnostic.subject?.nodes || [],
        edges: diagnostic.subject?.edges || [],
        elements: diagnostic.subject?.elements || [],
      },
      evidence: diagnostic.evidence || {},
      supportedFixes:
        diagnostic.supportedFixes || supportedFixes[diagnostic.code],
    });
  };
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  const rects: Rect[] = nodes.map((node) => ({
    id: node.id,
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + (node.width || 0),
    bottom: node.position.y + (node.height || 0),
  }));
  for (let left = 0; left < rects.length; left++)
    for (let right = left + 1; right < rects.length; right++) {
      const a = rects[left];
      const b = rects[right];
      if (
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top
      )
        push({
          code: "layout/node-overlap",
          severity: "error",
          message: `${a.id} and ${b.id} overlap in the resolved layout.`,
          subjects: [a.id, b.id],
          subject: { nodes: [a.id, b.id] },
          evidence: {
            overlapWidth: Math.min(a.right, b.right) - Math.max(a.left, b.left),
            overlapHeight:
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
          },
        });
    }

  const edgeSegments = new Map<string, Segment[]>();
  for (const edge of edges) {
    const points = routes.get(edge.id) || fallbackRoute(edge, lookup);
    const segments = points.slice(1).map((point, index) => ({
      from: points[index],
      to: point,
      edge,
    }));
    edgeSegments.set(edge.id, segments);
    segments.forEach((segment, index) => {
      const size = length(segment);
      if (options.checkRouteRhythm !== false && size > EPSILON && size < 8)
        push({
          code: "composition/micro-segment",
          severity: "warning",
          message: `${edge.id} contains a ${size.toFixed(1)}px segment.`,
          subjects: [edge.id],
          subject: { edges: [edge.id] },
          evidence: { segmentLength: Number(size.toFixed(2)), segmentIndex: index },
        });
      if (
        options.checkRouteRhythm !== false &&
        index > 0 &&
        index < segments.length - 1 &&
        size >= 8 &&
        size < 16
      )
        push({
          code: "composition/short-interior-segment",
          severity: "warning",
          message: `${edge.id} contains a short ${size.toFixed(1)}px interior turn.`,
          subjects: [edge.id],
          subject: { edges: [edge.id] },
          evidence: { segmentLength: Number(size.toFixed(2)), segmentIndex: index },
        });
      for (const rect of rects) {
        if (rect.id === edge.source || rect.id === edge.target) continue;
        if (segmentIntersectsRect(segment, rect))
          push({
            code: "clean-flow/edge-through-node",
            severity: "error",
            message: `${edge.id} crosses unrelated node ${rect.id}.`,
            subjects: [edge.id, rect.id],
            subject: { edges: [edge.id], nodes: [rect.id] },
          });
      }
    });
  }
  for (let left = 0; left < edges.length; left++)
    for (let right = left + 1; right < edges.length; right++) {
      const a = edges[left];
      const b = edges[right];
      if (sharesEndpoint(a, b)) continue;
      let crossed = false;
      let corridor = 0;
      for (const aSegment of edgeSegments.get(a.id) || [])
        for (const bSegment of edgeSegments.get(b.id) || []) {
          crossed ||= properIntersection(aSegment, bSegment);
          corridor = Math.max(corridor, collinearOverlap(aSegment, bSegment));
        }
      if (crossed)
        push({
          code: "composition/proper-crossing",
          severity: "error",
          message: `${a.id} and ${b.id} cross in the resolved layout.`,
          subjects: [a.id, b.id],
          subject: { edges: [a.id, b.id] },
        });
      if (corridor >= 16)
        push({
          code: "composition/ambiguous-corridor",
          severity: "error",
          message: `${a.id} and ${b.id} share an ambiguous ${corridor.toFixed(0)}px corridor.`,
          subjects: [a.id, b.id],
          subject: { edges: [a.id, b.id] },
          evidence: { corridorLength: Number(corridor.toFixed(2)) },
        });
    }

  for (const label of options.labels || []) {
    const padding = profile === "showcase" ? 4 : 2;
    const rect: Rect = {
      id: label.id,
      left: label.rect.left - padding,
      top: label.rect.top - padding,
      right: label.rect.right + padding,
      bottom: label.rect.bottom + padding,
    };
    for (const edge of edges) {
      if (edge.id === label.edgeId) continue;
      if ((edgeSegments.get(edge.id) || []).some((segment) => segmentIntersectsRect(segment, rect)))
        push({
          code: "composition/label-route-clearance",
          severity: "error",
          message: `${edge.id} enters the clearance area around label ${label.id}.`,
          subjects: [edge.id, label.id],
          subject: { edges: [edge.id], elements: [label.id] },
          evidence: { clearancePx: padding },
        });
    }
  }

  for (const boundary of options.boundaries || []) {
    const rect = { id: boundary.id, ...boundary.rect };
    for (const [edgeId, segments] of edgeSegments) {
      const run = segments.reduce(
        (longest, segment) => Math.max(longest, borderRun(segment, rect)),
        0,
      );
      if (run >= 24)
        push({
          code: "composition/boundary-border-run",
          severity: "error",
          message: `${edgeId} runs along boundary ${boundary.id} for ${run.toFixed(0)}px.`,
          subjects: [edgeId, boundary.id],
          subject: { edges: [edgeId], elements: [boundary.id] },
          evidence: { borderRunPx: Number(run.toFixed(2)) },
        });
    }
  }

  const minimumTextPx = options.minimumTextPx ?? 11;
  for (const text of options.projectedText || [])
    if (text.pixels < minimumTextPx)
      push({
        code: "composition/projected-text-readability",
        severity: "error",
        message: `${text.id} projects to ${text.pixels.toFixed(1)}px text, below ${minimumTextPx}px.`,
        subjects: [text.id],
        subject: { elements: [text.id] },
        evidence: {
          projectedTextPx: Number(text.pixels.toFixed(2)),
          minimumTextPx,
        },
      });

  const overflowX = Math.max(0, options.viewport?.overflowX || 0);
  const overflowY = Math.max(0, options.viewport?.overflowY || 0);
  if (overflowX > 1 || overflowY > 1)
    push({
      code: "render/viewport-overflow",
      severity: "error",
      message: `Rendered graph overflows its viewport by ${overflowX.toFixed(0)}px × ${overflowY.toFixed(0)}px.`,
      subjects: ["viewport"],
      subject: { elements: ["viewport"] },
      evidence: { overflowX: Number(overflowX.toFixed(2)), overflowY: Number(overflowY.toFixed(2)) },
    });

  const densityLimit = profile === "showcase" ? 12 : 80;
  const edgeLimit = profile === "showcase" ? 18 : 240;
  if (nodes.length > densityLimit || edges.length > edgeLimit)
    push({
      code: "composition/density",
      severity: "warning",
      message: `${nodes.length} nodes and ${edges.length} connections exceed the ${profile} readability budget.`,
      subjects: [],
      evidence: { nodeLimit: densityLimit, edgeLimit },
    });
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  const warnings = diagnostics.length - errors;
  const count = (code: VisualQualityCode) =>
    diagnostics.filter((diagnostic) => diagnostic.code === code).length;
  const projectedText = (options.projectedText || []).map((text) => text.pixels);
  return {
    contract: "witch.visual-quality/v1",
    profile,
    status: errors ? "fail" : warnings ? "warning" : "pass",
    nodeCount: nodes.length,
    edgeCount: edges.length,
    errors,
    warnings,
    metrics: {
      nodeOverlaps: count("layout/node-overlap"),
      edgeThroughNodes: count("clean-flow/edge-through-node"),
      properCrossings: count("composition/proper-crossing"),
      ambiguousCorridors: count("composition/ambiguous-corridor"),
      microSegments: count("composition/micro-segment"),
      shortInteriorSegments: count("composition/short-interior-segment"),
      labelRouteClearanceIssues: count("composition/label-route-clearance"),
      boundaryBorderRuns: count("composition/boundary-border-run"),
      projectedTextIssues: count("composition/projected-text-readability"),
      viewportOverflow: count("render/viewport-overflow"),
      minProjectedTextPx: projectedText.length
        ? Math.min(...projectedText)
        : null,
    },
    diagnostics,
  } satisfies VisualQualityReceipt;
}

export const emptyVisualQualityReceipt = (
  profile: VisualQualityReceipt["profile"] = "showcase",
): VisualQualityReceipt => ({
  contract: "witch.visual-quality/v1",
  profile,
  status: "pass",
  nodeCount: 0,
  edgeCount: 0,
  errors: 0,
  warnings: 0,
  metrics: {
    nodeOverlaps: 0,
    edgeThroughNodes: 0,
    properCrossings: 0,
    ambiguousCorridors: 0,
    microSegments: 0,
    shortInteriorSegments: 0,
    labelRouteClearanceIssues: 0,
    boundaryBorderRuns: 0,
    projectedTextIssues: 0,
    viewportOverflow: 0,
    minProjectedTextPx: null,
  },
  diagnostics: [],
});
