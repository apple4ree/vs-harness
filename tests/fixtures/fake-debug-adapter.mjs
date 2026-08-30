let buffer = Buffer.alloc(0);
let expected = null;
let sequence = 0;
let launchRequest = null;
let program = "";

function send(message) {
  const body = Buffer.from(JSON.stringify({ seq: ++sequence, ...message }));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function response(request, body = {}) {
  send({
    type: "response",
    request_seq: request.seq,
    command: request.command,
    success: true,
    body,
  });
}

function event(name, body = {}) {
  send({ type: "event", event: name, body });
}

function handle(request) {
  if (request.type !== "request") return;
  if (request.command === "initialize") return response(request, {});
  if (request.command === "launch") {
    launchRequest = request;
    program = request.arguments.program;
    event("initialized");
    return;
  }
  if (request.command === "setBreakpoints")
    return response(request, {
      breakpoints: (request.arguments.breakpoints || []).map((point) => ({
        verified: true,
        line: point.line,
      })),
    });
  if (request.command === "setExceptionBreakpoints")
    return response(request, {});
  if (request.command === "configurationDone") {
    response(request, {});
    response(launchRequest, {});
    setTimeout(
      () => event("stopped", { reason: "breakpoint", threadId: 7 }),
      20,
    );
    return;
  }
  if (request.command === "stackTrace")
    return response(request, {
      stackFrames: [
        {
          id: 11,
          name: "forecast",
          source: { path: program },
          line: 2,
          column: 1,
        },
      ],
    });
  if (request.command === "scopes")
    return response(request, {
      scopes: [
        {
          name: "Locals",
          variablesReference: 21,
          expensive: false,
        },
      ],
    });
  if (request.command === "variables")
    return response(request, {
      variables: [
        { name: "symbol", value: "'WITCH'", type: "str", variablesReference: 0 },
        { name: "prices", value: "[1, 2]", type: "list", variablesReference: 22 },
      ],
    });
  if (["continue", "next", "stepIn", "stepOut", "pause"].includes(request.command)) {
    response(request, {});
    event("continued", { threadId: 7 });
    if (request.command === "continue")
      setTimeout(() => {
        event("output", { category: "stdout", output: "PYTHON_DEBUG_DONE\n" });
        event("terminated", {});
      }, 20);
    return;
  }
  if (request.command === "threads")
    return response(request, { threads: [{ id: 7, name: "main" }] });
  if (request.command === "disconnect") {
    response(request, {});
    setTimeout(() => process.exit(0), 10);
    return;
  }
  send({
    type: "response",
    request_seq: request.seq,
    command: request.command,
    success: false,
    message: `Unsupported ${request.command}`,
  });
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    if (expected === null) {
      const boundary = buffer.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const headers = buffer.subarray(0, boundary).toString("ascii");
      buffer = buffer.subarray(boundary + 4);
      expected = Number(headers.match(/Content-Length:\s*(\d+)/i)?.[1]);
    }
    if (buffer.length < expected) return;
    const body = buffer.subarray(0, expected);
    buffer = buffer.subarray(expected);
    expected = null;
    handle(JSON.parse(body.toString("utf8")));
  }
});
