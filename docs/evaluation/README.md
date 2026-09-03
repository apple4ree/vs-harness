# Witch evaluation

[English](README.md) · [한국어](README.ko.md)

Witch publishes how it is measured without redistributing third-party benchmark
source. The goal is to make every performance or quality claim traceable to a
versioned analyzer, a declared corpus role, a metric definition, and a
reproducible command.

## What is evaluated

| Dimension             | Question                                                                                             | Primary evidence                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Analysis fidelity     | Does Witch recover source-backed structure, calls, workflows, behavior, and framework registrations? | Curated and external oracles, validation receipts, regression repositories |
| Explanation usability | Can a person answer architecture questions and reach the exact source evidence?                      | Comprehension tasks, deterministic layout checks, visual validation        |
| Developer workflow    | Can the ADE preserve edits through search, LSP, execution, debugging, and recovery?                  | Unit/integration tests, real Electron E2E, build and package checks        |
| Agent harness         | Are changes effective, isolated, reviewable, bounded, and replayable?                                | Task results, provider matrices, immutable journal and diff checks         |
| Safety and governance | Do authority, scope, approval, secret, rollback, and audit boundaries fail closed?                   | Fault injection, canaries, approval and receipt-integrity checks           |
| Scale and efficiency  | Does analysis and interaction remain bounded on large projects?                                      | Cold/warm/incremental time, peak process RSS, projection and UI latency    |

## Public evaluation documents

- [Methodology](methodology.md): evaluation lanes, execution boundaries, and anti-overfitting rules.
- [Datasets](datasets.md): external source references, revision pins, selection rules, and what is not vendored.
- [Metrics](metrics.md): exact definitions for precision, recall, F1, coverage, and non-vacuous cases.
- [Product benchmark](product-benchmark.md): cross-product classes, six independent dimensions, evidence levels, and external adapters.
- [Graph delivery and visual validation](visual-validation.md): projection, rendered-DOM, last-good, visual-matrix, and human-review gates.
- [Federation benchmark](../../benchmarks/federation/README.md): exact cross-repository links, ambiguity, authorship, approval, staleness, and order invariance.
- [Reproducibility](reproducibility.md): commands and required report metadata.
- [Limitations](limitations.md): what current results do not establish.
- [Call-graph result · 2026-09-02](results/callgraph-2026-09-02.md): current development and holdout measurements.
- [Product-quality result · 2026-09-02](results/product-quality-2026-09-02.md): current source-build verification.

## Publication rule

A result is publishable only when it records the source revision, analyzer or
application version, corpus role and scale, environment, command, execution
policy, failures, and metric validity. Micro and macro measurements are never
pooled into one score. A high scoped score must be shown next to its oracle
coverage.

Witch does not commit third-party benchmark checkouts, generated traces, local
absolute paths, credentials, or blind-holdout edge failures. The repository
contains manifests, runner code, aggregate receipts for local fixtures, and
human-readable methodology.
