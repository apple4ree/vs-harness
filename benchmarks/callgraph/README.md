# Call-graph evaluation sets

<!-- witch-doc-languages: ko,en -->

> **한국어:** Witch 호출 그래프 평가 corpus의 역할, 규모, 공개 범위와 재현 규칙을 설명합니다. 점수는 development·holdout·blind-holdout과 micro·macro 규모를 함께 밝혀야 합니다.
>
> **English:** This document defines the roles, scales, publication boundaries, and reproduction rules for Witch call-graph corpora. Every score must name both its evaluation role and scale.

Public definitions and interpretation rules:

- [Evaluation methodology](../../docs/evaluation/methodology.md)
- [Dataset declarations](../../docs/evaluation/datasets.md)
- [Metric definitions](../../docs/evaluation/metrics.md)
- [Reproduction guide](../../docs/evaluation/reproducibility.md)
- [Latest dated result](../../docs/evaluation/results/callgraph-2026-09-02.md)

Witch separates call-graph corpora by evaluation role and scale. A reported
score is incomplete unless it names both.

| Suite                    | Role          | Scale         | Rule                                                                   |
| ------------------------ | ------------- | ------------- | ---------------------------------------------------------------------- |
| SWARM-CG Python          | development   | micro         | Frozen regression set; never select new rules from individual failures |
| Witch Rust v1            | development   | micro         | Local regression set; improvements may close known gaps                |
| PyAnalyzer newly-added   | holdout       | micro         | Run at evaluation checkpoints only                                     |
| PyAnalyzer macro C       | holdout       | macro         | Five real projects; report each project separately                     |
| DyPyBench released pilot | blind holdout | macro/dynamic | Five fixed projects; compare only with released test-observed edges    |

`benchmark-callgraph.ts` accepts an optional manifest. The corpus root is the
directory represented by the manifest's `subpath`.

```powershell
npx tsx scripts/benchmark-callgraph.ts <corpus-root> <output.json> --manifest benchmarks/callgraph/pyanalyzer-macro-c-holdout.json
```

Development results may be inspected during implementation. Hold-out aggregate
results may be inspected only at a checkpoint, and their individual misses must
not drive the same implementation cycle. Blind hold-out aggregate and
per-project results may be recorded at a checkpoint, but per-edge failures stay
unavailable to implementation work. Regenerating all DyPyBench traces remains
an isolated release-candidate job; the checked-in manifest uses its small
official released result archive.

Every report includes oracle edge coverage and non-vacuous exact accuracy.
It also records metric validity so an empty precision denominator is presented
as `n/a` instead of evidence of perfect performance. Micro and macro results
must never be pooled into one F1 score.
