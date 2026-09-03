# Product-quality result · 2026-09-02

[English](product-quality-2026-09-02.md) · [한국어](product-quality-2026-09-02.ko.md)

Source commit: `fb308351fd81994d23627020fbe3a9bc946e1b8a`

Environment: Windows 11 x64, Node.js 22.14.0, Electron 44.0.0

Scope: source checkout verification; no new installer or signed release was
produced by this checkpoint.

## Gates

| Gate                       |     Result | Evidence boundary                                                                                                   |
| -------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`        |     passed | Main, Preload, Renderer, analysis, and benchmark TypeScript contracts                                               |
| `npm test`                 | 140 passed | Filesystem, LSP, debugger, PTY, analysis, Agent journal, provider protocol, evaluation, and safety regression tests |
| `npm run build`            |     passed | Main, Preload, and Renderer production bundles; 3,277 Renderer modules transformed                                  |
| `npm run test:e2e`         |  25 passed | Real Electron UI and IPC in temporary workspaces and profiles                                                       |
| Crawl4AI static regression |     passed | Valid Semantic IR with 6,576 symbols, 4,174 call relations, and 149 workflow participants                           |

The ordinary test suite did not call Codex, Claude, OpenAI, or Anthropic. Tests
of provider protocols used deterministic local processes. The Crawl4AI check
read source only and did not execute project code.

## Electron E2E coverage

The 25 scenarios include:

- graph context to isolated Agent change, canceled approval, selected apply,
  and graph refresh;
- repeated project switching with buffer, language, and graph isolation;
- file creation, rename, save, external conflict, BOM, and CRLF preservation;
- real TypeScript and Pyright diagnostics, navigation, completion, hover,
  signature help, rename review, and auto-import buffer edits;
- multiple PTYs, Project Tasks, Node and Python debugger paths, Runtime Trace,
  and controlled shutdown;
- SSH profile persistence without credential storage;
- settings, shortcut remapping, snippets, panel restoration, quick open,
  virtualized large folders, and breakpoint path migration.

## What this result does not claim

- No Windows installer or macOS universal package was rebuilt from this commit.
- No Apple Developer ID signing, notarization, installation, upgrade, or removal
  was tested.
- Live-model quality was not measured by the ordinary gates.
- The result does not establish VS Code extension compatibility or a complete
  remote workspace.
- Passing temporary-workspace E2E does not replace long-running use on diverse
  real monorepos.

See [limitations](../limitations.md) and the repository's historical
[verification log](../../verification.md) for platform and release receipts.
