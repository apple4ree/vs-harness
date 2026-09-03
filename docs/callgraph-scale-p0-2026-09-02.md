# P0 call-graph and scale hardening — 2026-09-02

[English](callgraph-scale-p0-2026-09-02.md) · [한국어](callgraph-scale-p0-2026-09-02.ko.md)

This report records the first implementation slice from the Witch benchmark
review. The run used `polyglot-static-v16` and `semantic-static-v11`.

## What changed

- TypeScript source files are parsed independently before `Program` creation.
- TypeScript roots are ordered dependency-first using an iterative topological
  pass. This prevents long import chains from nesting parser work on the
  JavaScript call stack.
- The deep TypeScript analysis ceiling increased from 2,500 files / 32 MB to
  5,000 files / 64 MB.
- Python and JavaScript now propagate directly passed callable arguments
  through function parameters.
- Stable local and module aliases are resolved before callable propagation.
- Propagated relationships remain `inferred`; direct TypeScript bindings remain
  `verified`.
- `npm run benchmark:callgraph` now provides a repository-owned SWARM-CG
  adapter and emits a detailed JSON receipt.

## SWARM-CG result

The scoped metric includes only edges whose source and target are symbols that
Witch currently declares. Module-level pseudo-functions and built-ins remain
outside this scope.

| Corpus                       | Scoped precision | Scoped recall | Scoped F1 | Previous F1 |
| ---------------------------- | ---------------: | ------------: | --------: | ----------: |
| Python `pycg_extended` (126) |            88.0% |         51.2% |     64.7% |       33.3% |
| JavaScript `swarm_js` (126)  |            84.0% |         51.2% |     63.6% |       38.5% |
| Combined (252)               |            86.0% |         51.2% |     64.2% |       35.8% |

The combined result increased true-positive scoped edges from 19 to 43 while
false positives increased from 3 to 7. This meets the first P0 target of at
least 60% scoped F1 without sacrificing the conservative precision profile.

## Scale result

The same synthetic import-chain benchmark that previously failed from 2,100
files now completes full semantic analysis.

| Files | Result |   Cold | Cached | One-file change | Peak RSS |
| ----: | ------ | -----: | -----: | --------------: | -------: |
| 2,100 | Pass   | 4.65 s | 0.97 s |          0.91 s |   273 MB |
| 5,000 | Pass   | 9.62 s | 2.14 s |          2.15 s |   433 MB |

Both runs retained every expected import relation and reported
`truncated: false` with no analysis warning.

## Reproduction

```powershell
npx tsx scripts/benchmark-architecture.ts 2100
npx tsx scripts/benchmark-architecture.ts 5000

npm run benchmark:callgraph -- `<SWARM Python root>` `<output.json>`
npm run benchmark:callgraph -- `<SWARM JavaScript root>` `<output.json>`
```

## Remaining P0/P1 gaps

- Python instance-field dispatch, inheritance/MRO, decorators and returned
  callables still need type-aware or bounded flow analysis.
- JavaScript/TypeScript property dispatch, class construction and returned
  callables remain intentionally conservative.
- Rust needs a labeled call-graph corpus before an accuracy claim can be made.
- The next scale step is package/SCC partitioning beyond 5,000 deep files,
  rather than another global ceiling increase.
