import type { Edge } from "@xyflow/react";
import {
  validateVisualGraph,
  type VisualEdge,
  type VisualNode,
  type VisualPoint,
  type VisualQualityValidationOptions,
} from "./architecture-visual-quality";
import type { RenderedGraphReceipt } from "./graph-delivery";

export type RenderedGraphSnapshot = {
  nodes: VisualNode[];
  edges: VisualEdge[];
  routes: Map<string, VisualPoint[]>;
  options: VisualQualityValidationOptions;
  viewport: { width: number; height: number; zoom: number };
};

export function validateRenderedGraphSnapshot(
  snapshot: RenderedGraphSnapshot,
  viewConfigHash: string,
  profile: "showcase" | "standard" = "showcase",
): RenderedGraphReceipt {
  const quality = validateVisualGraph(
    snapshot.nodes,
    snapshot.edges,
    snapshot.routes,
    profile,
    snapshot.options,
  );
  return {
    contract: "witch.rendered-graph/v1",
    valid: quality.status !== "fail",
    viewConfigHash,
    measuredAt: new Date().toISOString(),
    viewport: snapshot.viewport,
    quality,
  };
}

function elementRect(element: Element) {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function pathPoints(path: SVGPathElement): VisualPoint[] {
  let length = 0;
  try {
    length = path.getTotalLength();
  } catch {
    return [];
  }
  if (!Number.isFinite(length) || length <= 0) return [];
  const count = Math.max(2, Math.ceil(length / 24));
  const matrix = path.getScreenCTM();
  if (!matrix) return [];
  const svg = path.ownerSVGElement;
  if (!svg) return [];
  const point = svg.createSVGPoint();
  return Array.from({ length: count + 1 }, (_, index) => {
    const sample = path.getPointAtLength((length * index) / count);
    point.x = sample.x;
    point.y = sample.y;
    const screen = point.matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
}

export function inspectRenderedGraph(
  container: HTMLElement,
  input: {
    edges: Edge[];
    zoom: number;
    viewConfigHash: string;
    profile?: "showcase" | "standard";
  },
) {
  const nodeElements = Array.from(
    container.querySelectorAll<HTMLElement>(".react-flow__node[data-id]"),
  );
  const nodes: VisualNode[] = nodeElements.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      id: element.dataset.id || "unknown-node",
      position: { x: rect.left, y: rect.top },
      width: rect.width,
      height: rect.height,
    };
  });
  const edges: VisualEdge[] = input.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  }));
  const routes = new Map<string, VisualPoint[]>();
  for (const path of container.querySelectorAll<SVGPathElement>(
    ".react-flow__edge[data-id] .react-flow__edge-path",
  )) {
    const edgeId = path.closest<SVGGElement>(".react-flow__edge")?.dataset.id;
    const points = pathPoints(path);
    if (edgeId && points.length > 1) routes.set(edgeId, points);
  }
  const labels = Array.from(
    container.querySelectorAll<HTMLElement>(".react-flow__edge-textwrapper"),
  ).map((element, index) => ({
    id: `edge-label:${index}`,
    edgeId:
      element.closest<SVGGElement>(".react-flow__edge")?.dataset.id || undefined,
    rect: elementRect(element),
  }));
  const boundaries = Array.from(
    container.querySelectorAll<HTMLElement>("[data-architecture-boundary]"),
  ).map((element) => ({
    id: element.dataset.architectureBoundary || "boundary",
    rect: elementRect(element),
  }));
  const projectedText = Array.from(
    container.querySelectorAll<HTMLElement>(".architecture-card > strong"),
  ).map((element, index) => {
    const nodeId =
      element.closest<HTMLElement>(".react-flow__node")?.dataset.id ||
      `node-text:${index}`;
    const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) || 0;
    return { id: `${nodeId}:label`, pixels: fontSize * input.zoom };
  });
  const root = container.getBoundingClientRect();
  return validateRenderedGraphSnapshot(
    {
      nodes,
      edges,
      routes,
      options: {
        labels,
        boundaries,
        projectedText,
        minimumTextPx: 7,
        // Sampled curves are measurement chords rather than authored route
        // vertices, so their length must not be reported as route rhythm.
        checkRouteRhythm: false,
        viewport: {
          overflowX: Math.max(0, container.scrollWidth - container.clientWidth),
          overflowY: Math.max(0, container.scrollHeight - container.clientHeight),
        },
      },
      viewport: { width: root.width, height: root.height, zoom: input.zoom },
    },
    input.viewConfigHash,
    input.profile,
  );
}
