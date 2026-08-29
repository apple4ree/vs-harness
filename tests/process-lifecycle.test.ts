import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { JsonRpcProcess } from "../apps/desktop/src/main/services/json-rpc";

test("closing an RPC process waits for its owned process tree", async (t) => {
  const rpc = new JsonRpcProcess(
    process.execPath,
    [path.resolve("tests/fixtures/rpc-process-tree.mjs")],
    "lines",
    {},
  );
  t.after(() => rpc.dispose());
  const pids = await rpc.request<{ parent: number; child: number }>(
    "fixture/pids",
  );
  assert(
    pids.parent > 0 &&
      pids.child > 0 &&
      pids.parent !== process.pid &&
      pids.child !== process.pid,
  );
  await rpc.disposeAndWait();
  await rpc.disposeAndWait();
  for (const pid of [pids.parent, pids.child]) {
    let alive = true;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(alive, false, `Owned process ${pid} still exists`);
  }
});
