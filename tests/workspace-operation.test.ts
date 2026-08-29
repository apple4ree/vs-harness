import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceOperation } from "../apps/desktop/src/main/services/workspace-operation";

test("workspace operations reject overlapping work and release after success or failure", async () => {
  const gate = new WorkspaceOperation();
  let finish!: () => void;
  const pending = gate.run(
    "moving a folder",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  assert.equal(gate.busy, "moving a folder");
  let idle = false;
  const idlePromise = gate.whenIdle().then(() => {
    idle = true;
  });
  await Promise.resolve();
  assert.equal(idle, false);
  await assert.rejects(
    gate.run("opening a project", () => {
      throw new Error("Must not execute");
    }),
    /Wait for moving a folder/,
  );
  finish();
  await pending;
  await idlePromise;
  assert.equal(idle, true);
  assert.equal(gate.busy, null);
  await assert.rejects(
    gate.run("saving a file", () => {
      throw new Error("Disk error");
    }),
    /Disk error/,
  );
  assert.equal(gate.busy, null);
  assert.equal(await gate.run("saving a file", () => 42), 42);
});

test("queued workspace operations wait for the active mutation", async () => {
  const gate = new WorkspaceOperation();
  let finish!: () => void;
  const pending = gate.run(
    "saving a file",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let started = false;
  const queued = gate.enqueue("starting a terminal", () => {
    started = true;
    return 7;
  });
  await Promise.resolve();
  assert.equal(started, false);
  finish();
  await pending;
  assert.equal(await queued, 7);
  assert.equal(started, true);
  assert.equal(gate.busy, null);
});
