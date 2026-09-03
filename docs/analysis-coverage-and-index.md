# Witch analysis coverage and incremental index

<!-- witch-doc-languages: ko,en -->

> **한국어:** 각 Architecture reading이 표시해야 하는 분석 범위, 제외 사유, 언어별 깊이와 영속 증분 인덱스의 무효화·재사용 규칙을 정의합니다.
>
> **English:** This document defines analysis coverage, exclusion reasons, per-language depth, and the invalidation and reuse rules of the persistent incremental index.

- Implemented: 2026-08-31
- Analyzer: `polyglot-static-v8`
- Workflow policy: `evidence-first-workflow-v2`

## Coverage contract

Every new architecture reading carries structured coverage in addition to the
validated source and semantic graphs.

- `indexedFiles`: recognized source, configuration, style, and documentation
  files inside the normal workspace bounds.
- `analyzedFiles`: indexed files successfully represented by a source-backed
  file node.
- `deepFiles`: TypeScript/JavaScript, Python, and Rust files parsed for symbols
  and relations.
- `fileOnlyFiles`: recognized but semantically unsupported languages such as
  Java, Go, or Swift. These files remain visible without symbol, call, or
  workflow claims.
- `skippedFiles`: oversized, budget-excluded, unreadable, or file-index-truncated
  inputs.

The UI shows the aggregate ratio, per-language modes, cache reuse, and every
reached analysis limit. Call, workflow, participant, LSP sampling, byte, and
file-index limits are never silently presented as a complete result.

## Workflow entry policy

Workflow roots require source evidence. A symbol is eligible only when it is:

1. registered by a route, command, scheduler, task, event, listener, consumer,
   webhook, or equivalent annotation/signature;
2. a canonical top-level entry point such as `main`, `run`, `start`,
   `bootstrap`, or `entrypoint`; or
3. an exported or async top-level orchestration action whose name carries both
   an action and orchestration context.

Domain words alone do not make a workflow. UI components such as
`AgentAvatar`, utilities such as `runPreview`, and incidental names such as
`codepointOrder` remain ordinary symbols unless stronger entry evidence exists.
Test, documentation, example, fixture, sample, and benchmark paths are retained
as a bounded secondary source (at most 12 roots) so they can add evidence
without displacing production workflows from the default graph.

## Progressive graph contract

The first architecture screen is `Meaning · Overview` with the readable
backbone. It intentionally starts from System, Workflow, and Component instead
of expanding every file and symbol.

- Component inspector → **Explore component files**
- Workflow inspector → **Explore workflow steps**
- Readable backbone → bounded source-backed summary
- Complete map → explicit high-density opt-in

The source Modules, Files, and Focus views remain available and continue to use
the same validated architecture IR.

## Incremental index contract

The parsed-symbol index lives outside repositories under the Electron user-data
directory:

```text
<Witch user data>/indexes/<workspace-path-hash>.json
```

It stores relative paths, content hashes, file metadata, parsed symbols, and
imports. Source contents and provider credentials are not persisted in the
index.

- In-session reanalysis reuses in-memory content and parsed results.
- A later Witch process reuses durable parsed results when size and modified
  time match.
- File-watcher invalidations always force the affected paths to be reread.
- Analyzer-version mismatch, damaged input, wrong workspace, oversized index,
  or invalid entries fail closed to a fresh index.
- **Rebuild index** deletes only the exact active-project cache file and then
  performs a source rebuild.

Source hashes remain the canonical revision identity; metadata is only an
incremental reuse hint.
