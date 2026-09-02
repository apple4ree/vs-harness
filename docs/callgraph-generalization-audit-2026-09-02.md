# Call-graph generalization audit

Date: 2026-09-02  
Analyzer: `polyglot-static-v18` / `semantic-static-v13`  
Evaluation contract: `witch.external-callgraph-evaluation/v2`

## Conclusion

The Python and Rust analyzers do not contain benchmark names, fixture paths, or
per-case answers. The earlier headline Python score was nevertheless too
optimistic because most SWARM-CG cases had no comparable internal edge, and the
evaluator counted Witch edges outside the oracle's symbol universe only on the
precision side. Contract v2 makes the comparison symmetric and exposes oracle
coverage and vacuous cases.

Generalization is mixed rather than failed: precision is consistently high in
the mutually comparable symbol universe, while Python recall drops materially
on unfamiliar real projects. The next analyzer work should target broad
language mechanisms from an independent specification, then rerun hold-outs at
the next checkpoint. It must not copy individual PyAnalyzer or DyPyBench misses.

## Frozen evaluation lanes

| Corpus                   | Role          | Scale         | Cases | Oracle edge coverage | Non-vacuous cases | Scoped precision | Scoped recall | Scoped F1 |
| ------------------------ | ------------- | ------------- | ----: | -------------------: | ----------------: | ---------------: | ------------: | --------: |
| SWARM-CG Python          | development   | micro         |   126 |      50/278 (17.99%) |            33/126 |          100.00% |        78.00% |    87.64% |
| Witch Rust v1            | development   | micro         |    12 |         17/17 (100%) |             12/12 |          100.00% |        88.24% |    93.75% |
| PyAnalyzer newly-added   | holdout       | micro         |    10 |        4/17 (23.53%) |              2/10 |         100.00%* |         0.00% |     0.00% |
| PyAnalyzer macro C       | holdout       | macro         |     5 |    333/1051 (31.68%) |               3/5 |           91.61% |        42.64% |    58.20% |
| DyPyBench released pilot | blind holdout | macro/dynamic |     5 |     245/249 (98.39%) |               5/5 |          91.41%† |       47.76%† |   62.73%† |

\* No comparable Witch edge was predicted, so precision has an empty
denominator and is not evidence of correctness.  
† DyPyBench records calls observed while its tests ran. These are dynamic
agreement figures, not ordinary static-graph precision: an unobserved static
edge can still be correct.

Micro and macro rows are intentionally not pooled. Development results may be
used as regression gates; holdout and blind results are checkpoint evidence.

## Real-project detail

PyAnalyzer macro C uses manually curated call graphs. Two projects have no
shared declared-symbol universe and therefore do not receive an F1 score.

| Project             | Scoped gold | Scoped predicted | True positive | False positive | Precision | Recall |     F1 |
| ------------------- | ----------: | ---------------: | ------------: | -------------: | --------: | -----: | -----: |
| Sublist3r           |         109 |               69 |            63 |              6 |    91.30% | 57.80% | 70.79% |
| asciinema           |         133 |               58 |            51 |              7 |    87.93% | 38.35% | 53.40% |
| fabric              |          91 |               28 |            28 |              0 |   100.00% | 30.77% | 47.06% |
| autojump            |           0 |                0 |             0 |              0 |       n/a |    n/a |    n/a |
| face_classification |           0 |                0 |             0 |              0 |       n/a |    n/a |    n/a |

The DyPyBench pilot uses five official released dynamic graphs and source
checkouts selected by DyPyBench's own “last commit on or before 2023-01-18”
rule. No project code or test was executed during this audit.

| Project         | Source commit  | Observed gold | Scoped predicted | Matched | Dynamic agreement F1 |
| --------------- | -------------- | ------------: | ---------------: | ------: | -------------------: |
| flask-api       | `fdba680df667` |            27 |               20 |      17 |               72.34% |
| schedule        | `3eac646a8d26` |            12 |               11 |      11 |               95.65% |
| click           | `725e3e4a8da6` |            89 |               34 |      31 |               50.41% |
| python-patterns | `cc549613cec8` |            14 |                3 |       3 |               35.29% |
| requests        | `61c324da43dd` |           103 |               60 |      55 |               67.48% |

## Engineering corrections made during the audit

1. Fixed duplicate Python call sites emitted by fixed-point passes. Call sites
   are now unique by evidence path and ordinal.
2. Added a second participant de-duplication boundary before workflow
   projection. The previously failing Crawl4AI repository now completes with
   6,576 symbols, 4,174 calls, 149 workflow participants, and zero validation
   failure.
3. Added manifest-driven, path-bounded external cases, explicit source roots,
   DyPyBench name normalization, symmetric scoped precision, oracle coverage,
   and non-vacuous exact accuracy.
4. Replaced the Rust exact-score assertion with non-regression floors and a
   known-miss subset. Correct future improvements no longer break the test.
5. Assigned immutable development, holdout, and blind-holdout roles. The
   analyzer and semantic versions are recorded in every v2 receipt.

## Reproduction

Manifests live in `benchmarks/callgraph`. The evaluator never executes a target
repository.

```powershell
npx tsx scripts/benchmark-callgraph.ts <corpus-root> <output.json> --manifest <manifest.json>
npm run benchmark:callgraph:rust
```

The PyAnalyzer and DyPyBench source corpora are intentionally external to the
application repository. Their manifests pin upstream commits or upstream
revision rules without vendoring third-party source.

## Next checkpoint

1. Add specification-derived support for Python container/callback flow and
   module/package identity without consulting holdout edge lists.
2. Add a separately authored Rust macro holdout; the current Rust corpus is a
   development regression set only.
3. Re-run all frozen lanes and require: no development regression, improved
   macro recall, unchanged high scoped precision, and increased oracle coverage.
4. Expand the DyPyBench pilot only by a predeclared project list; do not choose
   projects based on favorable scores.
