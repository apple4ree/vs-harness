import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildSshInvocation,
  RemoteProfileService,
  sshExecutableCandidates,
} from "../apps/desktop/src/main/services/remote-profile-service";
import {
  REMOTE_PROTOCOL_VERSION,
  validateSshProfileDraft,
} from "../apps/desktop/src/shared/remote";

test("SSH profiles reject option injection and secret material", () => {
  assert.throws(
    () =>
      validateSshProfileDraft({
        label: "Bad",
        host: "-oProxyCommand=bad",
        port: 22,
        connectTimeoutSeconds: 15,
      }),
    /host name/,
  );
  assert.throws(
    () =>
      validateSshProfileDraft({
        label: "Bad",
        host: "server\nmalicious",
        port: 22,
        connectTimeoutSeconds: 15,
      }),
    /host/,
  );
  assert.throws(
    () =>
      validateSshProfileDraft({
        label: "Secret",
        host: "server",
        password: "never-store-this",
      }),
    /does not store/,
  );
  assert.throws(
    () =>
      validateSshProfileDraft({ label: "Bad port", host: "server", port: 0 }),
    /port/,
  );
});

test("SSH invocation keeps validated host last and disables LocalCommand", () => {
  const profile = {
    id: "55a73c6a-77b1-4eb1-890e-e77e12ed4860",
    label: "Research GPU",
    host: "gpu.internal",
    port: 2222,
    user: "witch",
    identityFile: path.resolve("fixture-key"),
    connectTimeoutSeconds: 20,
  };
  const args = buildSshInvocation(profile);
  assert.equal(args.at(-1), "gpu.internal");
  assert.deepEqual(args.slice(0, 3), ["-tt", "-o", "PermitLocalCommand=no"]);
  assert(args.includes("2222"));
  assert(args.includes("witch"));
  assert(args.includes(path.resolve("fixture-key")));
  assert.throws(
    () =>
      buildSshInvocation({
        ...profile,
        identityFile: "relative-key",
      }),
    /absolute path/,
  );
});

test("SSH executable discovery uses trusted absolute candidates", () => {
  assert.deepEqual(
    sshExecutableCandidates("win32", { SystemRoot: "D:\\Windows" }),
    ["D:\\Windows\\System32\\OpenSSH\\ssh.exe"],
  );
  assert(
    sshExecutableCandidates("darwin", {}).every((candidate) =>
      path.isAbsolute(candidate),
    ),
  );
  assert.throws(
    () => sshExecutableCandidates("linux", { WITCH_SSH_PATH: "./ssh" }),
    /absolute/,
  );
});

test("SSH profiles persist atomically without credentials", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "witch-remote-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const service = new RemoteProfileService(directory);
  let snapshot = await service.save({
    label: "Research GPU",
    host: "gpu.internal",
    port: 22,
    user: "witch",
    connectTimeoutSeconds: 15,
  });
  assert.equal(snapshot.protocol, REMOTE_PROTOCOL_VERSION);
  assert.equal(snapshot.profiles.length, 1);
  const id = snapshot.profiles[0].id;
  snapshot = await service.save({
    ...snapshot.profiles[0],
    label: "Research GPU updated",
  });
  assert.equal(snapshot.profiles.length, 1);
  assert.equal(snapshot.profiles[0].id, id);
  assert.equal(snapshot.profiles[0].label, "Research GPU updated");
  snapshot = await new RemoteProfileService(directory).list();
  assert.equal(snapshot.profiles[0].id, id);
  const stored = await fs.readFile(
    path.join(directory, "ssh-profiles.json"),
    "utf8",
  );
  assert(!/password|passphrase|privateKey/.test(stored));
  await service.remove(id);
  assert.equal((await service.list()).profiles.length, 0);
});

test("corrupt SSH profile storage fails closed with a warning", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "witch-remote-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "ssh-profiles.json"), "broken");
  const snapshot = await new RemoteProfileService(directory).list();
  assert.deepEqual(snapshot.profiles, []);
  assert.equal(snapshot.warnings.length, 1);
  await assert.rejects(
    () =>
      new RemoteProfileService(directory).save({
        label: "Must not overwrite",
        host: "server",
      }),
    /existing profile file is invalid/,
  );
  assert.equal(
    await fs.readFile(path.join(directory, "ssh-profiles.json"), "utf8"),
    "broken",
  );
});

test("one invalid stored SSH profile fails the complete file closed", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "witch-remote-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(directory, "ssh-profiles.json"),
    JSON.stringify({
      protocol: REMOTE_PROTOCOL_VERSION,
      profiles: [
        {
          id: "55a73c6a-77b1-4eb1-890e-e77e12ed4860",
          label: "Valid",
          host: "server",
          port: 22,
          connectTimeoutSeconds: 15,
        },
        { id: "broken", label: "Invalid", host: "-option" },
      ],
    }),
  );
  const snapshot = await new RemoteProfileService(directory).list();
  assert.deepEqual(snapshot.profiles, []);
  assert.equal(snapshot.warnings.length, 1);
});
