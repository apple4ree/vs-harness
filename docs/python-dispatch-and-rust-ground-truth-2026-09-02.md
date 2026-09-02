# Python dispatch and Rust ground-truth benchmark

Date: 2026-09-02  
Analyzer: `polyglot-static-v17` / `semantic-static-v12`

## Implemented analysis

- TypeScript/JavaScript property calls are accepted only when the TypeScript
  checker resolves the receiver property to one internal source declaration.
- Python receiver aliases (`alias = self`), constructed receiver types, and
  callable fields (`self.handler = self.execute`) resolve to bounded internal
  method targets.
- Python `super().method()` follows the immediate internal parent. An
  unresolved base `self.method()` can include at most eight internal descendant
  overrides at lower inferred confidence.
- Nested Python definitions retain lexical ownership. Decorators are applied
  bottom-up, returned wrapper functions replace decorated bindings, and closure
  parameters retain the original callable.
- Python callable returns resolve for both `selected = factory(); selected()`
  and `factory()()` without executing project code.

All non-direct dispatch remains visibly `inferred`; no runtime target is
promoted to authored or verified evidence.

## External Python measurement

The external SWARM-CG `pycg_extended` Python suite contains 126 cases. Witch
only scores edges whose two endpoint symbols are represented by its source
index; this is the `scoped` metric and prevents missing module pseudo-symbols
from being counted as parser errors.

| Metric | Before class/property work | Current |
| --- | ---: | ---: |
| Scoped precision | 88.00% | 97.50% |
| Scoped recall | 51.16% | 78.00% |
| Scoped F1 | 64.71% | 86.67% |
| Scoped exact cases | 109/126 | 117/126 |
| Analysis failures | 0 | 0 |

The remaining scoped misses are primarily container propagation through lists,
dictionaries, generators, constructor arguments, and default argument values.

## Rust ground truth v1

The repository now owns 12 manually authored Rust fixtures and 17 expected
internal edges. The corpus covers direct, module-qualified, aliased, instance,
associated, and trait-implementation calls plus branch/retry controls. Two
intentional hard cases measure callable parameters and returned callables.

| Metric | Result |
| --- | ---: |
| Cases | 12 |
| Exact cases | 10 |
| Precision | 100.00% |
| Recall | 88.24% |
| F1 | 93.75% |
| False positives | 0 |
| False negatives | 2 |

Run the reproducible benchmark with:

```powershell
npm run benchmark:callgraph:rust
```

The detailed machine-readable receipt is written to
`docs/benchmarks/rust-callgraph-ground-truth.json`. The regression test keeps
the exact v1 score and the two declared hard cases visible rather than silently
lowering the oracle.
