import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectReadableBackbone,
  validateVisualGraph,
  type VisualEdge,
  type VisualNode,
} from "../apps/desktop/src/renderer/src/components/architecture-visual-quality";

const node = (id: string, x = 0, y = 0): VisualNode => ({
  id,
  position: { x, y },
  width: 100,
  height: 60,
  data: { count: 1 },
});
const edge = (
  id: string,
  source: string,
  target: string,
  count = 1,
): VisualEdge => ({ id, source, target, data: { count } });

test("readable backbone is deterministic, bounded, acyclic and removes reciprocal clutter", () => {
  const nodes = Array.from({ length: 20 }, (_, index) => node(`n${index}`));
  const edges = nodes.flatMap((source, index) =>
    nodes
      .slice(index + 1)
      .flatMap((target, offset) => [
        edge(`${source.id}->${target.id}`, source.id, target.id, 100 - offset),
        edge(`${target.id}->${source.id}`, target.id, source.id, 50 - offset),
      ]),
  );
  const first = selectReadableBackbone(nodes, edges);
  const second = selectReadableBackbone(nodes, edges);
  assert.deepEqual(
    first.edges.map((item) => item.id),
    second.edges.map((item) => item.id),
  );
  assert(first.nodes.length <= 12);
  assert(first.edges.length <= first.nodes.length - 1);
  const pairs = first.edges.map((item) =>
    [item.source, item.target].sort().join(":"),
  );
  assert.equal(new Set(pairs).size, pairs.length);
});

test("visual validation reports edge crossings and unrelated node traversal", () => {
  const nodes = [
    node("left", 0, 0),
    node("middle", 150, 0),
    node("right", 300, 0),
    node("top", 150, -120),
    node("bottom", 150, 120),
  ];
  const edges = [
    edge("horizontal", "left", "right"),
    edge("vertical", "top", "bottom"),
  ];
  const routes = new Map([
    [
      "horizontal",
      [
        { x: 100, y: 30 },
        { x: 300, y: 30 },
      ],
    ],
    [
      "vertical",
      [
        { x: 200, y: -60 },
        { x: 200, y: 120 },
      ],
    ],
  ]);
  const receipt = validateVisualGraph(nodes, edges, routes);
  assert.equal(receipt.status, "fail");
  assert(
    receipt.diagnostics.some(
      (diagnostic) => diagnostic.code === "clean-flow/edge-through-node",
    ),
  );
  assert(
    receipt.diagnostics.some(
      (diagnostic) => diagnostic.code === "composition/proper-crossing",
    ),
  );
});

test("visual validation records label, boundary and projected text evidence", () => {
  const nodes = [node("left", 0, 0), node("right", 300, 0)];
  const edges = [edge("route", "left", "right")];
  const routes = new Map([
    [
      "route",
      [
        { x: 100, y: 30 },
        { x: 220, y: 30 },
        { x: 300, y: 30 },
      ],
    ],
  ]);
  const receipt = validateVisualGraph(nodes, edges, routes, "showcase", {
    labels: [
      {
        id: "unrelated-label",
        rect: { left: 145, top: 25, right: 175, bottom: 35 },
      },
    ],
    boundaries: [
      {
        id: "system-boundary",
        rect: { left: 120, top: 30, right: 200, bottom: 90 },
      },
    ],
    projectedText: [{ id: "left:label", pixels: 6.5 }],
    minimumTextPx: 7,
  });
  assert.equal(receipt.contract, "witch.visual-quality/v1");
  assert.equal(receipt.metrics.labelRouteClearanceIssues, 1);
  assert.equal(receipt.metrics.boundaryBorderRuns, 1);
  assert.equal(receipt.metrics.projectedTextIssues, 1);
  const diagnostic = receipt.diagnostics.find(
    (item) => item.code === "composition/label-route-clearance",
  );
  assert.deepEqual(diagnostic?.subject.elements, ["unrelated-label"]);
  assert(diagnostic?.supportedFixes.includes("move-edge-label"));
});
