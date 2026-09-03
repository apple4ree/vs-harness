# Python dispatch and Rust ground-truth benchmark

<!-- witch-doc-languages: ko,en -->

> **한국어:** Python class/property/decorator/반환 callable dispatch와 Rust 수동 ground-truth fixture에 대한 구현 및 측정 결과를 기록합니다.
>
> **English:** This report records the implementation and measurements for Python class/property/decorator/returned-callable dispatch and the manually authored Rust ground-truth fixture.

Date: 2026-09-02

Analyzer at original measurement: `polyglot-static-v17` / `semantic-static-v12`
Current analyzer after the duplicate-site fix: `polyglot-static-v18` / `semantic-static-v13`

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

The external SWARM-CG `pycg_extended` Python suite contains 126 development
cases. Evaluation contract v2 restricts both the oracle and Witch predictions
to the same declared-symbol universe. It also reports how much of the oracle is
actually in that universe, so a high scoped score cannot hide low coverage.

| Metric                  | Before class/property work |         Current |
| ----------------------- | -------------------------: | --------------: |
| Scoped precision        |                     88.00% |         100.00% |
| Scoped recall           |                     51.16% |          78.00% |
| Scoped F1               |                     64.71% |          87.64% |
| Non-vacuous exact cases |               not recorded |           25/33 |
| Oracle edge coverage    |               not recorded | 50/278 (17.99%) |
| Non-vacuous cases       |               not recorded | 33/126 (26.19%) |
| Analysis failures       |                          0 |               0 |

The score is therefore a useful development regression signal, not a claim of
87.64% performance over the complete corpus. Ninety-three cases have no
comparable internal edge and are excluded from non-vacuous exact accuracy.

## Rust ground truth v1

The repository now owns 12 manually authored Rust fixtures and 17 expected
internal edges. The corpus covers direct, module-qualified, aliased, instance,
associated, and trait-implementation calls plus branch/retry controls. Two
intentional hard cases measure callable parameters and returned callables.

| Metric          |  Result |
| --------------- | ------: |
| Cases           |      12 |
| Exact cases     |      10 |
| Precision       | 100.00% |
| Recall          |  88.24% |
| F1              |  93.75% |
| False positives |       0 |
| False negatives |       2 |

Run the reproducible benchmark with:

```powershell
npm run benchmark:callgraph:rust
```

The detailed machine-readable receipt is written to
`docs/benchmarks/rust-callgraph-ground-truth.json`. The regression test keeps
minimum precision, recall, F1, coverage, and exact-case floors. The two current
hard cases remain visible, while a legitimate fix may improve the result
without rewriting an exact expected score.
