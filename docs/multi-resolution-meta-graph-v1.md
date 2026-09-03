# Witch Multi-resolution Meta Graph v1 specification

[English](multi-resolution-meta-graph-v1.md) · [한국어](multi-resolution-meta-graph-v1.ko.md)

Status: P2 second stage implemented
Contract: `witch.graph-meta/v1`
Inputs: validated `witch.architecture/v1` with optional Semantic, Behavior, and Knowledge overlays

## 1. Objective

Shrinking every node and relation in a large repository onto one canvas preserves analysis volume but destroys human readability. Meta Graph aggregates the same validated graph into `System → Community → Component → Workflow → Symbol` resolutions so a reader can move from an overview to source evidence in explicit steps.

This hierarchy is a derived navigation projection. It never stores a community or fallback owner as authored architecture and never mutates Semantic IR.

## 2. Hierarchy

- **System:** the single navigation root for the current workspace
- **Community:** a cluster observed by the deterministic modularity projection
- **Component:** Semantic `component`, `module`, and `package` boundaries
- **Workflow:** Semantic workflows plus explicitly derived fallback groups that retain symbols without workflow ownership
- **Symbol:** Semantic symbols and workflow steps

Each meta node retains its exact member count, a bounded member preview, child IDs, source paths, per-kind counts, hub IDs, and its assignment rule. More than 160 members retain the exact count and a truncation flag while storing only the preview.

## 3. Ownership precedence

1. `contains` or `defines` relations, ranked Authored, Verified, Observed, then Inferred
2. Source-path affinity only when exactly one candidate matches
3. An `unassigned` derived fallback group inside the observed community

When one path has multiple candidates, Witch does not choose one arbitrarily. It uses a separate derived fallback and emits `META_FALLBACK_OWNERSHIP`.

## 4. Relation aggregation

Existing typed relations are projected between owners at every resolution. Relations with the same direction and resolution become one meta edge that retains:

- exact relation count and relation kinds
- up to 80 source relation IDs plus an omitted count
- counts by trust class
- average confidence
- up to eight source-hash-backed evidence records

Relations that become self-edges are hidden at that resolution. They reappear between concrete boundaries after drilling into the next level.

## 5. Validation and safety boundaries

- Bind the exact Source, Semantic, Behavior, and Knowledge revisions.
- Validate one System root and reciprocal `System → Community → Component → Workflow → Symbol` parent/child links.
- Validate meta-edge endpoints, levels, relation counts, and evidence path/hash.
- Validate canonical node and edge content against the deterministic meta revision.
- Allow at most 12,000 meta nodes and 20,000 meta edges.
- A UI frame shows at most 40 children by default and reports omitted nodes.
- Reversing input arrays must not change nodes, edges, or the meta revision.

An invalid meta graph is not delivered to the UI or Agent context.

## 6. Product behavior

**Intelligence → Map** places the current focus on the left and children at the next resolution on the right. Solid lines express hierarchy; dotted lines express aggregated typed relations at the current resolution. Breadcrumbs return to a parent and leaves open source. Source-backed meta nodes can also be attached to Agent context.

The shared Codex and Claude preflight receives only the contract revision, counts by level, the top 12 communities, and bounded source paths—not an unbounded copy of the large graph.

## 7. Intentional limitations

- A community is not claimed to be a globally optimal partition.
- A fallback group is not claimed to be a real component or workflow.
- Dynamic dispatch, runtime frequency, and selected branches require Runtime Trace evidence.
- The current projection covers one workspace. Multi-repository federation remains the next P2 stage.

## 8. Acceptance criteria

- A reader can drill from Community through Component and Workflow to Symbol.
- Explicit containment outranks path and community fallback.
- Parallel relations retain their counts and kinds after aggregation.
- Tampered evidence fails closed.
- A bounded meta summary is included in Provider-neutral Agent preflight.
- Electron E2E traverses from System to Community resolution.
