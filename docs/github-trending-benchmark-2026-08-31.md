# GitHub Trending Daily Top 10 — Witch real-repository benchmark

<!-- witch-doc-languages: ko,en -->

> **한국어:** 2026-08-31 GitHub Trending 상위 10개 실제 저장소를 고정해 Witch의 정적 구조 분석 성공률, 규모와 실패 원인을 측정한 보고서입니다.
>
> **English:** This report measures Witch's static-analysis success, scale, and failure causes on ten fixed real repositories from GitHub Trending on 2026-08-31.

> Follow-up: the same ten commits were rerun after coverage, workflow-policy,
> progressive-view, and persistent-index improvements. See
> [the before/after comparison](./github-trending-benchmark-2026-08-31-comparison.md).

- Assessment date: 2026-08-31 (Asia/Seoul)
- Ranking source: [GitHub Trending · repositories · daily · any language](https://github.com/trending?since=daily)
- Witch core revision: `0aed569` (`feature/python-rust-language-intelligence`)
- Host: Windows 11 x64, Node.js 22.14.0, rust-analyzer 1.98.0
- Checkout policy: shallow clone, no tags, Git LFS smudge disabled
- Safety: repositories were read only. No dependency installation, import, compilation, task, build, test, or repository code execution was performed.

## Method

Each checkout was measured in an isolated Node process through Witch's production `analyzeRepository` and `buildView` paths. The sequence was:

1. bounded workspace listing with normal Witch ignore rules;
2. cold static architecture and semantic analysis;
3. warm analysis with the same AST cache;
4. a third cached pass with bounded Pyright/rust-analyzer call-hierarchy corroboration;
5. module-view projection;
6. architecture/semantic receipt validation and process peak-RSS capture.

`Indexed` means a file extension that Witch includes as a file node. `Deep` means a TypeScript/JavaScript, Python, or Rust file for which the current engine has symbol/import parsing. Swift, Go, Java, Markdown and other indexed formats currently produce file-level nodes only. `LSP ms` includes the third cached semantic pass, so it is not pure server latency. Measurements are local observations, not universal performance guarantees.

Raw JSON and the ten clean checkouts are outside the Witch repository at `C:\Users\cdi65\witch-benchmarks\github-trending-2026-08-31`.

## Fixed benchmark set

| Rank | Repository                                                                                  | GitHub language | Stars today at capture | Commit     |
| ---: | ------------------------------------------------------------------------------------------- | --------------- | ---------------------: | ---------- |
|    1 | [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)                                   | TypeScript      |                  1,370 | `dfebbcf3` |
|    2 | [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | Python          |                  1,114 | `f6fcafeb` |
|    3 | [Lakr233/vphone-cli](https://github.com/Lakr233/vphone-cli)                                 | Swift           |                    361 | `2af884b5` |
|    4 | [tt-a1i/archify](https://github.com/tt-a1i/archify)                                         | JavaScript      |                  3,722 | `5de7275f` |
|    5 | [p-e-w/heretic](https://github.com/p-e-w/heretic)                                           | Python          |                    369 | `bedb94ef` |
|    6 | [unclecode/crawl4ai](https://github.com/unclecode/crawl4ai)                                 | Python          |                    221 | `7e801521` |
|    7 | [mvanhorn/last30days-skill](https://github.com/mvanhorn/last30days-skill)                   | Python          |                    230 | `a218edad` |
|    8 | [majd/ipatool](https://github.com/majd/ipatool)                                             | Go              |                     58 | `d5d0b56f` |
|    9 | [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)             | documentation   |                     96 | `8dc03837` |
|   10 | [checkstyle/checkstyle](https://github.com/checkstyle/checkstyle)                           | Java            |                    115 | `48efe82e` |

## Results

|   # | Repository              | Result                | Total files | Indexed |  Deep | Deep/total | Symbols | Calls | Workflows | Corroborated |
| --: | ----------------------- | --------------------- | ----------: | ------: | ----: | ---------: | ------: | ----: | --------: | -----------: |
|   1 | OpenMAIC                | Pass                  |       2,822 |   2,629 | 2,404 |      85.2% |  15,954 | 7,390 |       100 |            0 |
|   2 | scientific-agent-skills | Pass                  |       2,446 |   2,043 |   682 |      27.9% |   9,816 | 4,747 |       100 |          101 |
|   3 | vphone-cli              | Partial               |         336 |     268 |    31 |       9.2% |     147 |   124 |        14 |          121 |
|   4 | archify                 | Pass                  |         483 |     396 |   163 |      33.7% |   2,141 | 1,507 |        39 |            0 |
|   5 | heretic                 | Pass                  |          51 |      21 |    17 |      33.3% |     159 |    61 |         3 |           61 |
|   6 | crawl4ai                | **Failed closed**     |         900 |       — |     — |          — |       — |     — |         — |            — |
|   7 | last30days-skill        | Pass                  |         455 |     426 |   319 |      70.1% |   7,406 | 3,186 |       100 |          117 |
|   8 | ipatool                 | Empty semantic result |         154 |     147 |     0 |       0.0% |       0 |     0 |         0 |            0 |
|   9 | awesome-mcp-servers     | Empty semantic result |          11 |      10 |     0 |       0.0% |       0 |     0 |         0 |            0 |
|  10 | checkstyle              | Partial               |       9,322 |   7,430 |    11 |       0.1% |      75 |    68 |         0 |            0 |

Nine repositories completed and one failed closed. Across successful runs Witch listed 16,080 files, indexed 13,370, deeply parsed 3,627, emitted 35,698 symbols, 17,083 calls and 356 workflow candidates. Including the failed repository, the corpus contained 16,980 files. The low aggregate deep coverage is dominated by unsupported Java, Swift and Go rather than listing failure.

### Performance

|   # | Repository              |             Cold |    Warm | LSP pass | Peak RSS | Assessment                                            |
| --: | ----------------------- | ---------------: | ------: | -------: | -------: | ----------------------------------------------------- |
|   1 | OpenMAIC                |          14.28 s | 11.92 s |  11.64 s | 2,587 MB | Functionally complete, high memory/latency risk       |
|   2 | scientific-agent-skills |           5.17 s |  5.33 s |   7.73 s |   366 MB | Acceptable, LSP sampling bound reached                |
|   3 | vphone-cli              |           0.47 s |  0.45 s |   2.79 s |   163 MB | Fast but analyzes secondary Python, not primary Swift |
|   4 | archify                 |           2.27 s |  1.75 s |   1.73 s |   504 MB | Useful JS structure; workflow precision needs review  |
|   5 | heretic                 |           0.12 s |  0.08 s |   4.61 s |   149 MB | Best small-project semantic/LSP result                |
|   6 | crawl4ai                | failed at 2.87 s |       — |        — |        — | Fatal duplicate semantic ID                           |
|   7 | last30days-skill        |           1.82 s |  1.82 s |   4.87 s |   372 MB | Useful; workflow and LSP sampling bounds reached      |
|   8 | ipatool                 |           0.21 s |  0.21 s |   0.19 s |   133 MB | No Go semantics                                       |
|   9 | awesome-mcp-servers     |           0.03 s |  0.03 s |   0.03 s |   133 MB | File inventory only; expected for a list repository   |
|  10 | checkstyle              |          15.12 s | 14.75 s |  14.54 s |   219 MB | Expensive scan with negligible Java insight           |

Successful cold passes took 39.48 seconds in total and warm passes 36.33 seconds. Warm caching helps AST work but not directory walking, file reading, hashing and semantic reconstruction enough to materially improve the largest repositories.

## Quality observations

### Calls are the strongest current output

- TypeScript/JavaScript direct calls in OpenMAIC and archify were compiler-resolved and remained `verified/accepted`.
- Small Python heretic produced 61 calls and all 61 were independently corroborated by Pyright.
- vphone-cli's secondary Python tooling produced 124 calls, 121 corroborated.
- Large Python repositories hit the 48-caller LSP sample bound: scientific-agent-skills sampled 48 of 2,844 inferred callers; last30days-skill sampled 48 of 2,158. Absence outside that sample correctly remains provisional, but users do not yet see a coverage percentage.

### Workflow recall is high but precision is not established

- Scientific CLI `main`, `run_cli`, `check_run` and Python entry functions were plausible workflow roots.
- The heuristic also labeled React UI symbols such as `AgentAvatar`, `AgentBar`, `AgentVoicePill` and `AgentConfigPanel` as workflows because `agent` is a domain token.
- Archify candidates included plausible `runPreview`, `runVisualCheck` and `runGit`, but also utilities such as `codepointOrder` and `cleanBorderRunProblems`.
- Three repositories reached the silent 100-workflow cap. The graph's top-level `truncated` field remained false and no workflow-cap warning was emitted, so the result currently appears more complete than it is.

No labeled ground truth was created in this run, so these samples establish likely false positives and incompleteness, not a formal precision/recall score.

### One real robustness failure

crawl4ai consistently failed with `SEMANTIC_NODE_DUPLICATE` while reading `docs/md_v2/apps/crawl4ai-assistant/libs/marked.min.js`. The TypeScript/JavaScript symbol key is currently `file#name:line`; minified code can declare repeated same-name symbols on one physical line, creating duplicate semantic node IDs. Receipt validation correctly rejects the ambiguous graph, but the entire project becomes unavailable instead of degrading that file to a warning.

### Unsupported languages consume work without producing meaning

- ipatool: 147 indexed files, zero deep files and zero symbols because Go is unsupported.
- checkstyle: 7,430 indexed files and roughly 15 seconds per pass, but only 11 auxiliary JS files were deeply parsed; the Java architecture remained invisible.
- vphone-cli: the 147 symbols and 124 calls describe helper Python scripts, not the Swift application.
- File-level indexing is therefore not an adequate coverage indicator. Witch needs to display deep-language coverage separately.

## Overall judgment

| Dimension                    | Current result                                   | Judgment                                                |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| Robust completion            | 9/10                                             | Not yet safe for arbitrary public repositories          |
| TS/JS structure and calls    | Strong on two real projects                      | Useful now; large-project memory needs work             |
| Python structure and calls   | Strong on three successful projects              | LSP sampling coverage must be visible                   |
| Workflow inference           | Many candidates and branch evidence              | Exploratory only; likely false positives and silent cap |
| Rust                         | Live adapter verified separately                 | No Rust repository appeared in this daily top 10        |
| Swift/Go/Java                | File nodes only                                  | Major general-purpose ADE coverage gap                  |
| Large-repository performance | 2.6 GB peak on OpenMAIC; 15 s no-value Java scan | Product risk                                            |

The current engine is credible as a **Python/TypeScript/JavaScript architecture explorer**, especially for call analysis. It is not yet a language-neutral repository intelligence engine. The highest-value next corrections are:

1. make symbol IDs collision-safe and degrade a bad/minified file without losing the whole graph;
2. separate indexed-file coverage from deeply parsed language coverage in the UI;
3. avoid full content reads and repeated semantic rebuilds for unsupported languages;
4. expose workflow and LSP sampling caps explicitly;
5. tighten workflow rooting so domain-named UI components and utilities are not treated as workflows by name alone;
6. reduce TypeScript memory via narrower programs, incremental resolution or worker isolation;
7. only then decide whether Java, Go or Swift should be the next language adapter based on target users.

## Reproduction

The reusable runner is `scripts/benchmark-repository.ts`:

```powershell
npm run benchmark:repository -- `
  --rank 4 `
  --slug tt-a1i/archify `
  --root C:\absolute\path\to\checkout `
  --output C:\absolute\path\to\result.json
```

The output includes exact commit, file/extension inventory, static cold/warm timing, LSP pass timing, peak RSS, validation state, warning list, semantic kind/status/trust counts, and bounded workflow/call samples. Failed runs also write a structured failure JSON.
