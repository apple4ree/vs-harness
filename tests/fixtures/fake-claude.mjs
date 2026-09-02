// Protocol-only Claude Code stream-json double. No authentication or model is used.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const valueAfter = (name) => args[args.indexOf(name) + 1];
assert(args.includes("--print"));
assert.equal(valueAfter("--input-format"), "text");
assert.equal(valueAfter("--output-format"), "stream-json");
assert(args.includes("--strict-mcp-config"));
assert(args.includes("--disable-slash-commands"));
assert(args.includes("--no-chrome"));
assert(args.includes("--setting-sources="));
assert.equal(valueAfter("--settings"), '{"disableAllHooks":true}');
const sessionId = valueAfter("--session-id");
assert.match(sessionId, /^[a-f0-9-]{36}$/i);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString("utf8");
assert(prompt.includes("Witch ADE"));
assert(prompt.includes("Do not invoke external applications"));
const change = prompt.includes("CLAUDE_CHANGE");
assert.equal(valueAfter("--permission-mode"), change ? "acceptEdits" : "plan");
assert(args.includes("Read"));
assert(args.includes("Glob"));
assert(args.includes("Grep"));
assert.equal(args.includes("Edit"), change);
assert.equal(args.includes("Write"), change);
assert.equal(args.includes("Bash"), false);
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
send({ type: "system", subtype: "init", session_id: sessionId });
if (change) {
  await writeFile("main.ts", 'export const provider = "claude";\n');
  send({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Edit",
          input: { file_path: "main.ts" },
        },
      ],
    },
  });
}
send({
  type: "stream_event",
  event: {
    type: "content_block_delta",
    delta: { type: "text_delta", text: "Claude fixture " },
  },
});
send({
  type: "result",
  subtype: "success",
  is_error: false,
  session_id: sessionId,
  result: "Claude fixture complete.",
});
