// Protocol-only test double. No authentication, model, or external services are used.
import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
let sandbox = "read-only";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);
  if (!message.method) return;
  const params = message.params || {};
  if (message.method === "initialize")
    send({ id: message.id, result: { userAgent: "fixture" } });
  else if (message.method === "config/read")
    send({
      id: message.id,
      result: { config: { mcp_servers: { untrusted_server: {} } } },
    });
  else if (message.method === "thread/start") {
    assert.equal(params.config["mcp_servers.untrusted_server.enabled"], false);
    assert.equal(params.config["features.apps"], false);
    assert.equal(params.config["features.multi_agent"], false);
    sandbox = params.sandbox;
    send({
      id: message.id,
      result: {
        thread: { id: "fixture-thread" },
        cwd: process.cwd(),
        approvalPolicy: params.approvalPolicy,
        sandbox: {
          type: sandbox === "workspace-write" ? "workspaceWrite" : "readOnly",
          writableRoots: [],
          networkAccess: false,
        },
      },
    });
  } else if (message.method === "turn/start") {
    assert.equal(params.approvalPolicy, "never");
    assert.equal(params.sandboxPolicy.networkAccess, false);
    send({
      id: message.id,
      result: { turn: { id: "fixture-turn", status: "inProgress" } },
    });
    if (params.input[0].text.includes("WAIT_FOREVER")) return;
    if (params.input[0].text.includes("PARTIAL_EDIT")) {
      await writeFile(
        "greeting.ts",
        'export const greeting = "Partial edit";\n',
      );
      send({
        method: "item/started",
        params: {
          item: { type: "fileChange", changes: [{ path: "greeting.ts" }] },
        },
      });
      return;
    }
    if (sandbox === "workspace-write") {
      assert.deepEqual(params.sandboxPolicy.writableRoots, [process.cwd()]);
      await writeFile(
        "greeting.ts",
        'export const greeting = "Welcome to Witch";\n',
      );
    }
    send({
      method: "item/agentMessage/delta",
      params: { delta: "Fixture response" },
    });
    send({
      method: "item/completed",
      params: {
        item: {
          type: "agentMessage",
          phase: "final_answer",
          text: "Fixture complete.",
        },
      },
    });
    send({
      method: "turn/completed",
      params: { turn: { id: "fixture-turn", status: "completed" } },
    });
  } else if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    send({
      method: "turn/completed",
      params: { turn: { id: "fixture-turn", status: "interrupted" } },
    });
  }
});
