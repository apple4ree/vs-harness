# ADE, IDE, and code-intelligence product benchmark

[English](product-benchmark.md) · [한국어](product-benchmark.ko.md)

This guide defines how Witch should be evaluated as the market expands from
editors and code-graph viewers into ADEs, coding-Agent harnesses, and
computer-use development systems. The machine-readable source is
[`benchmarks/product/suite-v1.json`](../../benchmarks/product/suite-v1.json).

## 1. Why this is a benchmark suite, not one score

A graph explorer can have excellent call-edge precision without being an IDE.
An IDE can preserve edits and debug reliably without explaining architecture. A
coding Agent can resolve an issue while bypassing review boundaries. These are
different claims, so Witch publishes a **capability envelope** rather than a
weighted overall score.

Results remain separate across six dimensions:

| Dimension             | Question                                                                             | Typical evidence                                                                      |
| --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Analysis fidelity     | Are structure, calls, workflows, behavior, and framework relations source-backed?    | Precision, recall, F1, oracle coverage, validation failures                           |
| Explanation usability | Can a person answer architecture questions and reach exact evidence?                 | Task success, time-to-evidence, wrong selections, omission disclosure                 |
| Developer workflow    | Can editing, search, LSP, execution, debugging, and recovery preserve work?          | Scripted Electron scenarios, save fidelity, latency, package tests                    |
| Agent harness         | Does the complete product configuration produce bounded and reviewable changes?      | Task resolution, changed-path precision, verification, interventions, tokens and cost |
| Safety and governance | Are authority, scope, journals, approval, rollback, and secret boundaries preserved? | Fault injection, unauthorized-write count, rollback and receipt integrity             |
| Scale and efficiency  | Does the system remain bounded as repositories and trajectories grow?                | Cold/warm/incremental time, RSS, UI p95, context bytes                                |

No dimension compensates for another. A safety failure is not canceled by a
higher task-resolution rate.

## 2. Comparable product identity

The unit under test is not just a model and not just a desktop binary:

```text
product build + Provider/adapter + model + reasoning/configuration
              + benchmark revision + operating environment
```

Changing any part creates a new result. A Codex-backed Witch run and a
Claude-backed Witch run are separate configurations. Rules-only static analysis
is reported independently from AI-assisted composition.

## 3. Product classes and applicability

Every candidate declares one or more classes before tasks are selected:

| Product class           | Expected surface                                                | Examples of applicable evaluation               |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| Code-structure explorer | Index, graph, query, evidence navigation                        | Analysis fidelity, explanation, scale           |
| IDE                     | Editor, search, LSP, task, debugger                             | Developer workflow, platform reliability        |
| ADE                     | IDE surface plus Agent context, execution, review, and recovery | IDE plus Agent harness and governance           |
| Coding-Agent harness    | Issue/task to inspected patch                                   | Task resolution, scope, verification, cost      |
| Computer-use Agent      | Screenshot/UI observation and actions                           | Isolated desktop task success and action safety |

If a product claims a capability and the task applies, inability to perform it
is `fail`. If the capability is outside its declared class, it is
`not-applicable`, not zero and not a hidden exclusion. `not-run` and `partial`
are also retained in denominators where the protocol requires them.

## 4. Evidence levels

Feature matrices must label every cell:

- `documented`: supported only by the product's own current documentation;
- `observed`: manually reproduced, with date, build, environment, and evidence;
- `measured`: executed through the frozen common task and evaluator.

Documented capability is not converted into measured performance. Open-source
access permits source inspection but does not by itself prove runtime behavior.

## 5. Evaluation lanes

| Lane                       | Current maturity | Purpose                                                                     |
| -------------------------- | ---------------- | --------------------------------------------------------------------------- |
| P0 · Source conformance    | Automated        | Typecheck, unit/integration, production build, Electron E2E                 |
| P1 · Analysis oracle       | Automated        | Call graph, behavior, framework and validation accuracy                     |
| P2 · Repository scale      | Automated        | Cold/warm/restart/incremental cost and bounded projections                  |
| P3 · Human comprehension   | Protocol-defined | Whether the visual explanation helps people answer real questions           |
| P4 · Agent task completion | Partial          | Offline deterministic harness now; repeated live task suites later          |
| P5 · Adversarial recovery  | Partial          | Scope escape, source mutation, malformed output, interrupted runs, rollback |
| P6 · Packaged platform     | Protocol-defined | Install, launch, upgrade, recovery, and uninstall on Windows and macOS      |

`Automated` means a repository command exists. It does not mean every external
corpus or operating system runs in ordinary CI.

## 6. Human comprehension protocol

Graph readability should be measured through questions, not aesthetic votes
alone. For each pinned repository, participants receive the same starting view
and answer tasks such as:

1. Find the source entry point for a named request or job.
2. Identify the next component and the evidence supporting that relation.
3. Locate a branch, retry, or unresolved dynamic dispatch.
4. Distinguish an inferred relation from verified, authored, or observed facts.
5. Move from a workflow summary to the exact source line and back.

Record answer correctness, median time-to-evidence, wrong source selections,
navigation count, and whether omitted graph content was visible. Randomize tool
order, use the same repository revision and tasks, and report participant count
and prior familiarity. Screenshot review remains supplementary qualitative
evidence.

## 7. Agent task protocol

Live Agent comparisons require at least three independent runs per task and
configuration when budget permits. Publish:

- task pass/fail from executable tests, not the Agent's completion message;
- changed-path precision and unrelated edit count;
- verification commands and their exit status;
- human approval or intervention count;
- wall time, input/output tokens, cache usage, and cost;
- original-write, path-escape, secret-egress, and receipt-integrity events;
- incomplete, timed-out, refused, and infrastructure-failed runs.

The same model on a CLI and inside Witch is useful for measuring harness value.
A different model compares complete products, not interface quality alone.

## 8. External benchmark adapters

External suites are attached only to the dimension they actually measure:

| Benchmark                                                                                  | Useful Witch question                                             | Boundary                                                    |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| [SWARM-CG](https://github.com/secure-software-engineering/SWARM-CG), PyAnalyzer, DyPyBench | Does the static call graph agree with curated or observed edges?  | Does not measure IDE or visual usability                    |
| [SWE-bench](https://github.com/SWE-bench/SWE-bench)                                        | Can a complete Agent configuration resolve pinned real issues?    | Patch success does not establish safe review or IDE quality |
| [IDE-Bench](https://github.com/AfterQuery/ide-bench)                                       | Can an Agent work through an IDE-native structured tool surface?  | Candidate adapter; dataset and harness terms must be pinned |
| [Terminal-Bench](https://github.com/harbor-framework/terminal-bench)                       | Can an Agent complete terminal tasks in a controlled environment? | Measures terminal Agent work, not code-graph explanation    |
| [OSWorld](https://github.com/xlang-ai/OSWorld)                                             | Can a future CUA configuration complete isolated desktop tasks?   | Deferred while Witch CUA remains observation-only           |
| [AgentDojo](https://github.com/ethz-spylab/agentdojo)                                      | Which attack/defense patterns should inform harness tests?        | Reference-only; not a coding-ADE score                      |

An external adapter's presence in the manifest is not a result. `candidate`,
`planned`, `deferred`, and `reference-only` states must remain visible.

## 9. Fair comparison procedure

1. Freeze product classes, claims, corpus revisions, tasks, and metrics before a run.
2. Use clean, equivalent environments and disclose unavailable dependencies.
3. Separate static read-only analysis from runs that install or execute project code.
4. Keep model, effort, tool permissions, context limits, and timeout fixed within a comparison arm.
5. Run each applicable task; preserve failures and excluded cases with reasons.
6. Report per-dimension results, confidence intervals where repeated, and raw counts.
7. Keep development, holdout, and blind-holdout results separate.
8. Publish artifacts that permit audit without leaking credentials, private code, or blind answers.

GitHub stars, feature counts, and screenshot preference are landscape signals,
not benchmark accuracy.

## 10. Near-term Witch benchmark roadmap

1. Add a versioned P3 comprehension-task manifest for three Python/Rust/TS repositories.
2. Capture interaction events needed for time-to-evidence without recording source content.
3. Add packaged Windows smoke evaluation, then the equivalent macOS receipt.
4. Add a small public P4 issue-to-patch pilot with Codex and Claude configurations reported separately.
5. Extend P5 with prompt-injection, secret canary, symlink, process-tree, interrupted-apply, and rollback cases.
6. Add an independent Rust macro holdout before expanding the development fixture score.

Until those lanes are implemented, the current dated results remain the only
measured claims.
