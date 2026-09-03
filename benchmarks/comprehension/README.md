# Human architecture-comprehension benchmark

[English](README.md) · [한국어](README.ko.md)

This protocol measures whether a person can use Witch to locate entry points,
follow an agent/risk dependency, identify retry evidence, and round-trip from a
graph to source. The Python, Rust, and TypeScript cases express the same task.

Witch does not manufacture a human score. A session is final only after a named
reviewer records task outcomes. The evaluator reports task success, median time
to matching evidence, wrong source selections, and navigation count separately.
It rejects source contents and any aggregate or weighted score.

```sh
npm run benchmark:comprehension:check
npm run benchmark:comprehension:check -- --session path/to/session.json
```

Use `witch.comprehension-session/v1` events (`task-start`, `view-open`,
`node-select`, `edge-select`, `source-open`, `answer`) and pseudonymous
participant IDs. Paths and graph IDs are allowed; source text is not.
