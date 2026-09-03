# Graph delivery and visual validation

[English](visual-validation.md) · [한국어](visual-validation.ko.md)

Witch treats a graph shown on screen as a delivered artifact, not as an
automatic consequence of valid source analysis. Three receipts remain
separate:

| Contract | Gate |
| --- | --- |
| `witch.visual-quality/v1` | Deterministic projection geometry |
| `witch.rendered-graph/v1` | Measured React Flow DOM/SVG output |
| `witch.graph-delivery/v1` | Source + projection + rendered delivery |

The projection validator checks node overlap, unrelated edge-through-node,
proper crossings, ambiguous shared corridors, route rhythm, label clearance,
boundary-border runs, projected text size, density, and viewport overflow. Each
diagnostic includes its subjects, measured evidence, and supported fix classes.

After React Flow paints, Witch measures actual node rectangles, sampled SVG
routes, edge-label rectangles, projected label size, and viewport overflow. A
candidate becomes `accepted` only when source, projection, and rendered stages
are valid. If a later candidate fails, Witch keeps the latest validated view for
that view family and reports `preserved-last-good`. With no earlier valid view,
the rejected candidate stays visible with an explicit failure; it is never
silently labeled valid.

## Reproduce

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run capture:visual-matrix -- path/to/project test-results/visual-matrix
```

The matrix captures night, twilight, and high-contrast themes at desktop and
compact viewports for overview and component lenses. It writes the individual
screenshots, `contact-sheet.html`, `contact-sheet.png`, and
`visual-matrix-receipt.json`. A machine-valid receipt does not approve visual
semantics; a named human review is still required for a published visual claim.

The first-candidate Composer and comprehension protocols are versioned under
`benchmarks/semantic-composer` and `benchmarks/comprehension`. Composer results
remain separated by Provider. Human comprehension results remain `pending`
until a named reviewer completes all fixed tasks.
