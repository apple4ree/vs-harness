# Semantic Composer first-candidate benchmark

[English](README.md) · [한국어](README.ko.md)

This suite measures whether one frozen Composer response remains grounded in
Witch's validated source candidates. Python, Rust, and TypeScript fixtures share
the same four-part agent/order flow, so language support is compared without
changing the conceptual task.

The runner never executes fixture code. It analyzes source, calls the selected
Composer exactly once with fallback disabled, freezes its graph and receipt,
then reports source, semantic, composition, evidence-grounding, and projection
results separately. A machine pass is not a human visual approval.

```sh
npm run benchmark:composer
npm run benchmark:composer -- --provider codex --case python-agent-risk
```

AI-backed runs can use an installed, signed-in Codex or Claude Code CLI. Record
the provider, model, Witch revision, environment, and the unmodified first
candidate when publishing a result.
