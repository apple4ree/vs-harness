import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { corroborateSymbolCalls } from "../apps/desktop/src/main/services/call-corroboration";
import type { LanguageIntelligence } from "../apps/desktop/src/main/services/language-intelligence";
import type { ArchitectureNode } from "../apps/desktop/src/shared/architecture";

test("call hierarchy corroborates matches and flags only unambiguous internal line conflicts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-corroborate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const callerText = "def run_agent():\n    return expected()\n";
  const targetText =
    "def expected():\n    return True\n\ndef observed():\n    return False\n";
  await fs.writeFile(path.join(root, "caller.py"), callerText);
  await fs.writeFile(path.join(root, "targets.py"), targetText);
  const nodes: ArchitectureNode[] = [
    {
      id: "caller.py",
      label: "caller.py",
      kind: "file",
      path: "caller.py",
      module: "root",
      language: "py",
      count: 1,
      hash: "caller-hash",
      evidence: [{ path: "caller.py", line: 1, hash: "caller-hash" }],
      symbols: [
        {
          id: "caller.py#run_agent:1",
          name: "run_agent",
          kind: "function",
          line: 1,
          endLine: 2,
          exported: false,
        },
      ],
    },
    {
      id: "targets.py",
      label: "targets.py",
      kind: "file",
      path: "targets.py",
      module: "root",
      language: "py",
      count: 1,
      hash: "target-hash",
      evidence: [{ path: "targets.py", line: 1, hash: "target-hash" }],
      symbols: [
        {
          id: "targets.py#expected:1",
          name: "expected",
          kind: "function",
          line: 1,
          endLine: 2,
          exported: false,
        },
        {
          id: "targets.py#observed:4",
          name: "observed",
          kind: "function",
          line: 4,
          endLine: 5,
          exported: false,
        },
      ],
    },
  ];
  const calls = [
    {
      fromSourceSymbolId: "caller.py#run_agent:1",
      toSourceSymbolId: "targets.py#expected:1",
      trust: "inferred" as const,
      resolver: "python-static" as const,
      evidence: [
        {
          path: "caller.py",
          line: 2,
          hash: "caller-hash",
          excerpt: "return expected()",
        },
      ],
    },
  ];
  const fake = (target: "expected" | "observed") =>
    ({
      status: async () => ({
        installed: true,
        connected: false,
        message: "ready",
        providers: [
          {
            id: "python",
            label: "Pyright",
            installed: true,
            connected: false,
            message: "ready",
          },
        ],
      }),
      outgoingCalls: async () => ({
        provider: "python" as const,
        caller: {
          name: "run_agent",
          path: "caller.py",
          range: {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 21 },
          },
          selectionRange: {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 13 },
          },
        },
        outgoing: [
          {
            name: target,
            path: "targets.py",
            range: {
              start: { line: target === "expected" ? 0 : 3, character: 0 },
              end: { line: target === "expected" ? 1 : 4, character: 16 },
            },
            selectionRange: {
              start: {
                line: target === "expected" ? 0 : 3,
                character: 4,
              },
              end: {
                line: target === "expected" ? 0 : 3,
                character: 12,
              },
            },
            fromRanges: [
              {
                start: { line: 1, character: 11 },
                end: { line: 1, character: 19 },
              },
            ],
          },
        ],
      }),
    }) as unknown as LanguageIntelligence;

  const matched = await corroborateSymbolCalls(
    { root, nodes, calls },
    fake("expected"),
  );
  assert.equal(matched.observations[0]?.status, "corroborated");
  const conflict = await corroborateSymbolCalls(
    { root, nodes, calls },
    fake("observed"),
  );
  assert.deepEqual(
    conflict.observations.map((item) => ({
      status: item.status,
      inferred: item.inferredToSourceSymbolId,
      observed: item.observedToSourceSymbolId,
    })),
    [
      {
        status: "conflicting",
        inferred: "targets.py#expected:1",
        observed: "targets.py#observed:4",
      },
    ],
  );
});
