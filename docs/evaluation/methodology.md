# Evaluation methodology

[English](methodology.md) · [한국어](methodology.ko.md)

## 1. Measurement lanes

Every corpus is assigned a role before a run.

| Role            | Purpose                                                      | Permitted use                                                                                  |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `development`   | Detect regressions while analysis rules are implemented      | Aggregate and individual failures may be inspected                                             |
| `holdout`       | Test transfer to a separately authored corpus                | Run only at checkpoints; failures cannot drive the same implementation cycle                   |
| `blind-holdout` | Test a predeclared release candidate against unseen evidence | Publish aggregate and per-project results; keep edge-level failures out of implementation work |

Each role also declares `micro`, `macro`, or `macro/dynamic` scale. Results from
different roles or scales remain separate even when they share a metric name.

## 2. Static analysis protocol

The call-graph protocol is:

```text
Frozen manifest + fixed source checkout
  → bounded source inventory
  → Witch static architecture and semantic analysis
  → canonical source-symbol names
  → mutually comparable symbol universe
  → edge comparison and coverage calculation
  → versioned JSON receipt
```

Opening or benchmarking a repository does not import, compile, install, test,
or execute its code. Symlinks and paths outside the declared corpus root are not
accepted by the manifest runner. Dynamic observations are consumed only when an
upstream benchmark has already released them.

Every receipt identifies the architecture and semantic analyzer versions. A
change that can alter graph output increments those versions so persistent
caches cannot silently mix results.

## 3. Product-quality protocol

Product claims use progressively broader gates:

1. Type checking validates shared Main, Preload, and Renderer contracts.
2. Unit and integration tests exercise real filesystem, language server,
   debugger, PTY, analysis, journal, and safety boundaries where practical.
3. Production build verifies the actual Electron bundles.
4. Electron E2E drives the workbench through its public UI and IPC surface in
   temporary workspaces and profiles.
5. Platform packaging and packaged-app E2E are separate release gates. A source
   build result does not imply that a new Windows or macOS package exists.

Provider protocol tests use deterministic local doubles by default. A live
Codex or Claude run is reported separately and never implied by the ordinary
test count.

## 4. Scale protocol

Performance reports distinguish:

- cold analysis with an empty cache;
- warm analysis with an in-memory cache;
- restart analysis using the persistent index;
- one-file incremental analysis;
- canonical graph size from the bounded screen projection;
- analyzer-process RSS from total Electron memory.

The source revision, machine, operating system, Node and Electron versions,
cache state, timeout, file count, and failure count belong in the same result.

## 5. Anti-overfitting policy

- Corpus roles and project lists are frozen in manifests before results are
  inspected.
- Production analyzers must not contain benchmark names, fixture paths, or
  case-specific expected edges.
- Holdout edge failures cannot be copied into rules during the same cycle.
- Analyzer changes must describe a general language or framework mechanism and
  receive an independently authored regression test.
- Improvements must retain development floors and high precision while
  increasing holdout recall or coverage.
- Empty scoped cases are disclosed and excluded from non-vacuous exact rates.
- A failed analysis remains a failure; it is never removed from the denominator
  without a published corpus revision.

## 6. Human and visual evaluation

Deterministic layout tests can measure bounds, crossings, unrelated-node
traversal, omitted nodes, and projection stability. They do not prove that a
diagram explains a system well. Presentation claims therefore require a dated
screenshot review with the same repository revision and view settings. Human
review results are reported separately from call-graph accuracy.
