# Reproducing Witch evaluation

[English](reproducibility.md) · [한국어](reproducibility.ko.md)

## Environment

Use Node.js 22 or newer and install the locked dependencies:

```sh
npm ci
```

A public result should record:

```text
Witch Git commit
operating system and CPU architecture
Node, npm, and Electron versions
architecture and semantic analyzer versions
corpus URL and full revision
corpus role and scale
command and timeout
cold, warm, or persistent-cache state
whether project code was executed
evaluated, failed, and excluded case counts
metricValidity and oracle coverage
```

Machine-specific absolute paths must be removed from a published receipt.

## Product gates

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

These commands do not call a paid AI provider. Electron E2E uses temporary
workspaces and application profiles. Provider protocol cases use local test
doubles unless a result explicitly says it was a live opt-in run.

The complete ordinary source gate is:

```sh
npm run test:all
```

Validate the cross-product benchmark taxonomy and its no-composite-score policy:

```sh
npm run benchmark:product:check
```

This validates the local contract only. It does not run or download any external
benchmark, product, Provider, container, or VM.

Run the Witch-owned static Federation regression suite:

```sh
npm run benchmark:federation:check
```

It analyzes six local npm, Python, and Cargo multi-repository cases without
executing their code. The report keeps link, question, authored mapping,
approval, staleness, validation, and order-invariance metrics separate.

Package verification is a separate platform-specific operation. See the root
README and GitHub workflows for Windows and macOS packaging commands.

## Local call-graph fixture

The Rust development corpus is included because Witch owns it:

```sh
npm run benchmark:callgraph:rust
```

This writes a machine-readable v2 receipt to
[`docs/benchmarks/rust-callgraph-ground-truth.json`](../benchmarks/rust-callgraph-ground-truth.json).

## External call-graph corpora

Fetch third-party repositories outside the Witch checkout. Verify their full
commit against the manifest, then run:

```powershell
npx tsx scripts/benchmark-callgraph.ts <corpus-root> <output.json> --manifest <manifest.json>
```

Example for a PyAnalyzer macro checkout:

```powershell
npx tsx scripts/benchmark-callgraph.ts `
  <PyAnalyzer>/Data/RQ3/macro-benchmark C `
  <reports>/pyanalyzer-macro-c-v2.json `
  --manifest benchmarks/callgraph/pyanalyzer-macro-c-holdout.json
```

The runner resolves every case root and oracle path beneath `<corpus-root>` and
rejects absolute paths, traversal, duplicate case IDs, and unsupported oracle
formats. It reads repository source but does not run it.

For DyPyBench, arrange the external workspace as declared by its manifest:

```text
<corpus-root>/
  DyPyBench/experiments/DynaPyt_output/dynapyt_*.json
  dypybench-projects/flask-api/
  dypybench-projects/schedule/
  dypybench-projects/click/
  dypybench-projects/python-patterns/
  dypybench-projects/requests/
```

The released JSON files come from the upstream archive. Each project checkout
must use the last commit on or before 2023-01-18, matching DyPyBench's own setup
script. Do not regenerate or execute the projects during the ordinary static
comparison.

## Repository scale

```sh
npm run benchmark -- 5000
npm run benchmark:repository -- <public-git-checkout> <output.json>
npm run benchmark:behavior -- <public-git-checkout> <output.json>
npm run benchmark:frameworks -- <public-git-checkout> <output.json>
```

The synthetic benchmark isolates scale behavior. A fixed public checkout tests
real repository structure. Neither supplies call-graph accuracy unless it also
has a declared oracle.

## Offline Agent evaluation

```sh
npm run eval:offline
```

The fixture hash is checked before and after evaluation. Replay cannot call a
provider or execute a command. Live evaluation requires the provider to be
declared live, runner opt-in, explicit user approval, and
`WITCH_LIVE_EVAL=1`; it is not part of default CI.

## Publishing a result

1. Freeze or verify the manifest before opening result details.
2. Run the appropriate source or benchmark gate.
3. Preserve the complete failure count.
4. Remove only machine-local paths and secrets, not unfavorable cases.
5. Publish aggregate metrics with coverage and metric validity.
6. Label dynamic observations and manual visual reviews explicitly.
7. Link the dated result from the evaluation index without replacing older
   receipts.
