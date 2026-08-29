import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "../apps/desktop/src/main/services/session-store";
import { contentHash } from "../apps/desktop/src/main/services/workspace-files";

test("session journals preserve drafts and validate roots, paths and baselines", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "witch-session-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "project");
  const service = new SessionStore(path.join(directory, "state"));
  assert.equal((await service.get(root)).session, null);
  const value = {
    root,
    view: "source" as const,
    activePath: "one.ts",
    documents: [
      {
        path: "one.ts",
        draft: {
          content: "unsaved",
          savedContent: "original",
          hash: contentHash("original"),
        },
      },
      { path: "two.ts" },
    ],
  };
  await service.save(root, value);
  assert.equal(
    (await new SessionStore(path.join(directory, "state")).get(root)).session
      ?.documents[0].draft?.content,
    "unsaved",
  );
  await assert.rejects(
    service.save(root, { ...value, root: path.join(directory, "other") }),
    /session/,
  );
  await assert.rejects(
    service.save(root, { ...value, documents: [{ path: "../outside" }] }),
    /escapes/,
  );
  await assert.rejects(
    service.save(root, {
      ...value,
      documents: [
        {
          path: "one.ts",
          draft: { ...value.documents[0].draft!, hash: "incorrect" },
        },
      ],
    }),
    /draft/,
  );
  await service.discardDrafts(root);
  assert.equal(
    (await service.get(root)).session?.documents[0].draft,
    undefined,
  );
  assert.equal((await service.get(root)).session?.documents.length, 2);
  assert(
    (await fs.readdir(path.join(directory, "state"))).some((file) =>
      file.endsWith(".previous"),
    ),
  );
  await service.save(root, value);
  await service.save(root, value);
  const stateDirectory = path.join(directory, "state");
  const current = path.join(
    stateDirectory,
    (await fs.readdir(stateDirectory)).find((file) => file.endsWith(".json"))!,
  );
  await fs.writeFile(current, "truncated journal");
  const recovering = new SessionStore(stateDirectory);
  const recovery = await recovering.get(root);
  assert.equal(recovery.session?.documents[0].draft?.content, "unsaved");
  assert.match(recovery.warning!, /previous recovery snapshot/);
  await recovering.save(root, value);
  await recovering.save(root, value);
  const damaged = (await fs.readdir(stateDirectory)).find((file) =>
    file.includes(".corrupt-"),
  )!;
  assert.equal(
    await fs.readFile(path.join(stateDirectory, damaged), "utf8"),
    "truncated journal",
  );
});
