# Call-graph evaluation result · 2026-09-02

Source commit: `fb308351fd81994d23627020fbe3a9bc946e1b8a`

Analyzer: `polyglot-static-v18` / `semantic-static-v13`

Contract: `witch.external-callgraph-evaluation/v2`

Execution policy: source-only static analysis; target repositories were not
imported, compiled, installed, tested, or executed.

## Result

| Corpus                   | Role          | Scale         | Cases | Oracle edge coverage | Non-vacuous cases | Scoped precision | Scoped recall | Scoped F1 |
| ------------------------ | ------------- | ------------- | ----: | -------------------: | ----------------: | ---------------: | ------------: | --------: |
| SWARM-CG Python          | development   | micro         |   126 |      50/278 (17.99%) |            33/126 |          100.00% |        78.00% |    87.64% |
| Witch Rust v1            | development   | micro         |    12 |         17/17 (100%) |             12/12 |          100.00% |        88.24% |    93.75% |
| PyAnalyzer newly-added   | holdout       | micro         |    10 |        4/17 (23.53%) |              2/10 |              n/a |         0.00% |     0.00% |
| PyAnalyzer macro C       | holdout       | macro         |     5 |    333/1051 (31.68%) |               3/5 |           91.61% |        42.64% |    58.20% |
| DyPyBench released pilot | blind-holdout | macro/dynamic |     5 |     245/249 (98.39%) |               5/5 |          91.41%* |       47.76%* |   62.73%* |

PyAnalyzer micro precision is `n/a` because Witch emitted no comparable edge;
there is no valid precision denominator. The resulting recall and F1 are zero.

\* DyPyBench figures are dynamic agreement with calls observed by upstream
tests. They are not complete static-graph precision or recall.

## Interpretation

No production analyzer rule contains a benchmark name, fixture path, or
case-specific expected edge. The result nevertheless shows that the former
headline Python number was optimistic: only 17.99% of SWARM-CG oracle edges and
26.19% of its cases contribute to a non-vacuous scoped comparison.

Witch remains conservative and precise inside the mutually comparable symbol
universe, but Python recall falls on unfamiliar macro projects. This is evidence
of incomplete generalization, especially around package identity and indirect
call flow. It is not evidence that the analyzer memorized the development
corpus.

Micro and macro results are intentionally not pooled. Development rows are
regression signals; holdout rows are checkpoint evidence.

## PyAnalyzer macro projects

Two projects have no mutually comparable oracle edge and do not receive a
project F1.

| Project             | Scoped gold | Scoped predicted | Matched | False positive | Precision | Recall |     F1 |
| ------------------- | ----------: | ---------------: | ------: | -------------: | --------: | -----: | -----: |
| Sublist3r           |         109 |               69 |      63 |              6 |    91.30% | 57.80% | 70.79% |
| asciinema           |         133 |               58 |      51 |              7 |    87.93% | 38.35% | 53.40% |
| fabric              |          91 |               28 |      28 |              0 |   100.00% | 30.77% | 47.06% |
| autojump            |           0 |                0 |       0 |              0 |       n/a |    n/a |    n/a |
| face_classification |           0 |                0 |       0 |              0 |       n/a |    n/a |    n/a |

## DyPyBench released pilot

The pilot uses upstream released observations and source checkouts selected by
DyPyBench's own last-commit-on-or-before-2023-01-18 rule.

| Project         | Source commit  | Observed scoped gold | Scoped predicted | Matched | Dynamic agreement F1 |
| --------------- | -------------- | -------------------: | ---------------: | ------: | -------------------: |
| flask-api       | `fdba680df667` |                   27 |               20 |      17 |               72.34% |
| schedule        | `3eac646a8d26` |                   12 |               11 |      11 |               95.65% |
| click           | `725e3e4a8da6` |                   89 |               34 |      31 |               50.41% |
| python-patterns | `cc549613cec8` |                   14 |                3 |       3 |               35.29% |
| requests        | `61c324da43dd` |                  103 |               60 |      55 |               67.48% |

## Regressions fixed at this checkpoint

- Fixed duplicate Python call sites produced by repeated fixed-point passes.
- Added a second workflow-participant de-duplication boundary.
- Restored successful validation of the fixed Crawl4AI checkout: 6,576 symbols,
  4,174 call relations, 149 workflow participants, and no Semantic IR failure.
- Made scoped comparison symmetric and added oracle coverage, non-vacuous case
  accuracy, explicit metric validity, and an F1 zero-agreement regression test.
- Replaced an exact Rust score pin with non-regression floors that allow genuine
  improvements to close the two current hard cases.

## Reproduction references

- [Methodology](../methodology.md)
- [Dataset declarations](../datasets.md)
- [Metric definitions](../metrics.md)
- [Commands](../reproducibility.md)
- [Call-graph manifests](../../../benchmarks/callgraph/README.md)
- [Rust machine-readable receipt](../../benchmarks/rust-callgraph-ground-truth.json)
