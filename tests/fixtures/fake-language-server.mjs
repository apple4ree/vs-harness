// Protocol safety fixture: only this test process logs commands in its disposable cwd.
import { appendFile } from "node:fs/promises";
let buffer = Buffer.alloc(0);
let uri;
const edit = () => ({
  changes: {
    [uri]: [
      {
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 18 },
        },
        newText: "renamed",
      },
    ],
  },
});
function send(value) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...value });
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}
async function receive(message) {
  if (message.method === "initialize")
    send({ id: message.id, result: { capabilities: {} } });
  else if (message.method === "textDocument/didOpen")
    uri = message.params.textDocument.uri;
  else if (message.method === "workspace/didChangeWatchedFiles")
    await appendFile(
      "watched-files.txt",
      JSON.stringify(message.params.changes) + "\n",
    );
  else if (message.method === "textDocument/codeAction")
    send({
      id: message.id,
      result: [
        { title: "Text-only fix", kind: "quickfix", edit: edit() },
        {
          title: "Unsafe refactor command",
          command: { command: "_typescript.applyRefactoring", arguments: [] },
        },
        {
          title: "Organize imports",
          command: { command: "_typescript.organizeImports", arguments: [] },
        },
      ],
    });
  else if (message.method === "workspace/executeCommand") {
    await appendFile("executed-commands.txt", message.params.command + "\n");
    send({ id: 900, method: "workspace/applyEdit", params: { edit: edit() } });
    send({ id: message.id, result: null });
  } else if (message.method === "shutdown")
    send({ id: message.id, result: null });
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) break;
    const length = Number(
      buffer
        .subarray(0, end)
        .toString()
        .match(/Content-Length:\s*(\d+)/i)?.[1],
    );
    if (buffer.length < end + 4 + length) break;
    const body = buffer.subarray(end + 4, end + 4 + length);
    buffer = buffer.subarray(end + 4 + length);
    void receive(JSON.parse(body.toString("utf8")));
  }
});
