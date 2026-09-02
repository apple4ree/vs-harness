import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { accessSync, constants, promises as fs, statSync } from "node:fs";
import path from "node:path";
import {
  REMOTE_PROTOCOL_VERSION,
  validateSshProfileDraft,
  type RemoteProfileSnapshot,
  type RemoteStatus,
  type SshProfile,
} from "../../shared/remote";

function isExecutable(file: string, platform: NodeJS.Platform) {
  try {
    return (
      path.isAbsolute(file) &&
      statSync(file).isFile() &&
      (accessSync(file, platform === "win32" ? constants.F_OK : constants.X_OK),
      true)
    );
  } catch {
    return false;
  }
}

export function sshExecutableCandidates(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = environment.WITCH_SSH_PATH;
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  if (configured && !platformPath.isAbsolute(configured))
    throw new Error("WITCH_SSH_PATH must be an absolute executable path");
  if (platform === "win32") {
    const root =
      Object.entries(environment).find(
        ([key]) => key.toLowerCase() === "systemroot",
      )?.[1] || "C:\\Windows";
    if (!/^[a-z]:[\\/]/i.test(root) || !path.win32.isAbsolute(root))
      throw new Error("SystemRoot must be an absolute local Windows directory");
    return [
      ...(configured ? [configured] : []),
      path.win32.join(root, "System32", "OpenSSH", "ssh.exe"),
    ];
  }
  return [
    ...(configured ? [configured] : []),
    "/usr/bin/ssh",
    "/bin/ssh",
    "/usr/local/bin/ssh",
    "/opt/homebrew/bin/ssh",
  ];
}

export function findSshExecutable(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return (
    sshExecutableCandidates(platform, environment).find((candidate) =>
      isExecutable(candidate, platform),
    ) || null
  );
}

export function buildSshInvocation(profile: SshProfile) {
  const validated = validateSshProfileDraft(profile);
  if (!validated.id) throw new Error("SSH profile id is required");
  if (validated.identityFile && !path.isAbsolute(validated.identityFile))
    throw new Error("SSH identity file must be an absolute path");
  return [
    "-tt",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    `ConnectTimeout=${validated.connectTimeoutSeconds}`,
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-p",
    String(validated.port),
    ...(validated.user ? ["-l", validated.user] : []),
    ...(validated.identityFile ? ["-i", validated.identityFile] : []),
    validated.host,
  ];
}

export function sshDisplayTarget(profile: SshProfile) {
  const host = profile.host.includes(":") ? `[${profile.host}]` : profile.host;
  return `${profile.user ? profile.user + "@" : ""}${host}:${profile.port}`;
}

export class RemoteProfileService {
  private writes: Promise<void> = Promise.resolve();
  constructor(private directory: string) {}

  private get file() {
    return path.join(this.directory, "ssh-profiles.json");
  }

  async flush() {
    await this.writes;
  }

  private async write(profiles: SshProfile[]) {
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.directory, { recursive: true });
        const temporary = this.file + ".tmp";
        await fs.writeFile(
          temporary,
          JSON.stringify(
            { protocol: REMOTE_PROTOCOL_VERSION, profiles },
            null,
            2,
          ) + "\n",
          { encoding: "utf8", mode: 0o600 },
        );
        await fs.rename(temporary, this.file);
        if (process.platform !== "win32")
          await fs.chmod(this.file, 0o600).catch(() => undefined);
      });
    await this.writes;
  }

  async list(): Promise<RemoteProfileSnapshot> {
    await this.writes.catch(() => undefined);
    const warnings: string[] = [];
    let raw: unknown;
    try {
      const bytes = await fs.readFile(this.file);
      if (bytes.length > 1_000_000)
        throw new Error("SSH profile file exceeds 1 MB");
      raw = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { protocol: REMOTE_PROTOCOL_VERSION, profiles: [], warnings };
      return {
        protocol: REMOTE_PROTOCOL_VERSION,
        profiles: [],
        warnings: [`SSH profiles could not be loaded. ${error}`],
      };
    }
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      (raw as { protocol?: unknown }).protocol !== REMOTE_PROTOCOL_VERSION ||
      !Array.isArray((raw as { profiles?: unknown }).profiles)
    )
      return {
        protocol: REMOTE_PROTOCOL_VERSION,
        profiles: [],
        warnings: ["SSH profile file uses an unsupported format"],
      };
    const storedProfiles = (raw as { profiles: unknown[] }).profiles;
    if (storedProfiles.length > 100)
      return {
        protocol: REMOTE_PROTOCOL_VERSION,
        profiles: [],
        warnings: ["SSH profile file exceeds the 100 profile limit"],
      };
    const profiles: SshProfile[] = [];
    for (const [index, profile] of storedProfiles.entries()) {
      try {
        const validated = validateSshProfileDraft(profile);
        if (!validated.id) throw new Error("SSH profile id is missing");
        if (validated.identityFile && !path.isAbsolute(validated.identityFile))
          throw new Error("SSH identity file must be an absolute path");
        if (profiles.some((item) => item.id === validated.id))
          throw new Error("Duplicate SSH profile id");
        profiles.push(validated as SshProfile);
      } catch (error) {
        warnings.push(`SSH profile ${index + 1} was ignored. ${error}`);
      }
    }
    if (warnings.length)
      return { protocol: REMOTE_PROTOCOL_VERSION, profiles: [], warnings };
    return {
      protocol: REMOTE_PROTOCOL_VERSION,
      profiles: profiles.sort((a, b) => a.label.localeCompare(b.label)),
      warnings,
    };
  }

  async save(value: unknown): Promise<RemoteProfileSnapshot> {
    const draft = validateSshProfileDraft(value);
    if (draft.identityFile && !path.isAbsolute(draft.identityFile))
      throw new Error("SSH identity file must be an absolute path");
    const current = await this.list();
    if (current.warnings.length)
      throw new Error(
        "SSH profiles could not be changed because the existing profile file is invalid",
      );
    const id = draft.id || randomUUID();
    const profile = { ...draft, id } as SshProfile;
    const profiles = current.profiles.filter((item) => item.id !== id);
    if (draft.id && profiles.length === current.profiles.length)
      throw new Error("SSH profile no longer exists");
    profiles.push(profile);
    await this.write(profiles.sort((a, b) => a.label.localeCompare(b.label)));
    return this.list();
  }

  async remove(id: string): Promise<RemoteProfileSnapshot> {
    if (typeof id !== "string" || !/^[a-f0-9-]{16,100}$/i.test(id))
      throw new Error("Invalid SSH profile id");
    const current = await this.list();
    if (current.warnings.length)
      throw new Error(
        "SSH profiles could not be changed because the existing profile file is invalid",
      );
    const profiles = current.profiles.filter((profile) => profile.id !== id);
    if (profiles.length === current.profiles.length)
      throw new Error("SSH profile no longer exists");
    await this.write(profiles);
    return this.list();
  }

  async resolve(id: string) {
    const profile = (await this.list()).profiles.find((item) => item.id === id);
    if (!profile) throw new Error("SSH profile no longer exists");
    return profile;
  }

  status(): RemoteStatus {
    const executable = findSshExecutable();
    if (!executable)
      return {
        protocol: REMOTE_PROTOCOL_VERSION,
        ssh: {
          installed: false,
          message:
            "OpenSSH was not found in a trusted system location. Install the OS OpenSSH client or set WITCH_SSH_PATH to an absolute executable.",
        },
      };
    const result = spawnSync(executable, ["-V"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      shell: false,
    });
    const version = `${result.stderr || ""}${result.stdout || ""}`
      .trim()
      .slice(0, 300);
    const installed = !result.error && result.status === 0;
    return {
      protocol: REMOTE_PROTOCOL_VERSION,
      ssh: {
        installed,
        executable,
        ...(version ? { version } : {}),
        message: installed
          ? "System OpenSSH is ready. Authentication remains with ssh-agent, SSH config, or the selected identity file."
          : `OpenSSH could not be inspected. ${result.error?.message || `Exited with code ${result.status ?? "unknown"}`}`,
      },
    };
  }
}
