import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGraphDeliveryReceipt,
  LastGoodGraphStore,
  stableViewConfigHash,
} from "../apps/desktop/src/renderer/src/components/graph-delivery";
import { validateRenderedGraphSnapshot } from "../apps/desktop/src/renderer/src/components/rendered-graph-validator";
import { emptyVisualQualityReceipt } from "../apps/desktop/src/renderer/src/components/architecture-visual-quality";

test("graph delivery requires source, projection and rendered validation", () => {
  const hash = stableViewConfigHash("revision|overview|readable");
  const rendered = validateRenderedGraphSnapshot(
    {
      nodes: [
        {
          id: "a",
          position: { x: 0, y: 0 },
          width: 100,
          height: 60,
        },
        {
          id: "b",
          position: { x: 180, y: 0 },
          width: 100,
          height: 60,
        },
      ],
      edges: [{ id: "a-b", source: "a", target: "b" }],
      routes: new Map([
        [
          "a-b",
          [
            { x: 100, y: 30 },
            { x: 180, y: 30 },
          ],
        ],
      ]),
      options: { projectedText: [{ id: "a:label", pixels: 12 }] },
      viewport: { width: 800, height: 600, zoom: 1 },
    },
    hash,
  );
  const receipt = createGraphDeliveryReceipt({
    sourceRevision: "source-r1",
    semanticRevision: "semantic-r1",
    sourceValid: true,
    viewConfigHash: hash,
    projection: emptyVisualQualityReceipt(),
    rendered,
  });
  assert.equal(receipt.contract, "witch.graph-delivery/v1");
  assert.equal(receipt.valid, true);
  assert.deepEqual(receipt.stages, {
    analysis: "pass",
    projection: "pass",
    rendered: "pass",
  });
});

test("last-good graph store preserves the accepted view after a rejected candidate", () => {
  const store = new LastGoodGraphStore<{ revision: string }>();
  assert.equal(
    store.resolve("overview", { revision: "r1" }, true).state,
    "accepted",
  );
  const resolution = store.resolve("overview", { revision: "r2" }, false);
  assert.equal(resolution.state, "preserved-last-good");
  assert.equal(resolution.value.revision, "r1");
});
