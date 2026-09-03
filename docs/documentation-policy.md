# Witch Documentation Language Policy

[English](documentation-policy.md) · [한국어](documentation-policy.ko.md)

Public Witch documentation is maintained as separate English and Korean editions.

- The English edition uses the canonical `.md` path, such as `README.md` or `docs/methodology.md`.
- The Korean edition uses the matching `.ko.md` path, such as `README.ko.md` or `docs/methodology.ko.md`.
- Both files include reciprocal language-navigation links at the top.
- Entry-point documents provide equivalent core usage, supported scope, verification results, and safety boundaries in both editions.
- New or materially changed normative requirements, safety boundaries, and evaluation interpretations must update both files together.
- Code, commands, API names, IR schemas, metric names, and measured values must not change during translation.
- Generated documentation must emit both English and Korean files from its generator.
- If the languages disagree, re-check implementation and verification evidence and correct them to the same meaning. Do not change facts by treating either language as arbitrarily authoritative.

Run `npm run docs:check` to verify edition pairs and reciprocal navigation in every tracked Markdown document. This mechanical check does not replace translation review; reviewers must also compare meaning, measurements, links, and unsupported-scope statements.
