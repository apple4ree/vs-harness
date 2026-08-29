import { accessSync, constants, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SpawnOptionsWithoutStdio } from "node:child_process";

export function cliSearchDirectories(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory = os.homedir(),
): string[] {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const candidates = Object.entries(environment)
    .filter(([key]) => key.toUpperCase() === "PATH")
    .flatMap(([, value]) =>
      (value || "").split(platform === "win32" ? ";" : ":"),
    )
    .map((entry) => entry.replace(/^"|"$/g, ""));
  if (platform === "win32") {
    if (environment.APPDATA)
      candidates.push(paths.join(environment.APPDATA, "npm"));
    if (environment.LOCALAPPDATA)
      candidates.push(
        paths.join(environment.LOCALAPPDATA, "Microsoft/WinGet/Links"),
      );
    candidates.push(
      paths.join(homeDirectory, ".local/bin"),
      paths.join(homeDirectory, ".bun/bin"),
    );
  } else {
    candidates.push(
      paths.join(homeDirectory, ".local/bin"),
      paths.join(homeDirectory, ".npm-global/bin"),
      paths.join(homeDirectory, ".volta/bin"),
      paths.join(homeDirectory, ".bun/bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    );
  }
  const seen = new Set<string>();
  return candidates.filter((entry) => {
    if (!paths.isAbsolute(entry)) return false;
    const key = platform === "win32" ? entry.toLowerCase() : entry;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function installedDirectories(): string[] {
  const directories = cliSearchDirectories();
  if (process.platform !== "win32") {
    // Finder does not inherit a login shell's nvm PATH. Inspect known install
    // locations without executing shell startup files or repository code.
    const versions = path.join(os.homedir(), ".nvm/versions/node");
    try {
      for (const version of readdirSync(versions)
        .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .slice(0, 20))
        directories.push(path.join(versions, version, "bin"));
    } catch {
      /* nvm is optional */
    }
  }
  return directories;
}

function isExecutable(file: string) {
  try {
    if (!path.isAbsolute(file) || !statSync(file).isFile()) return false;
    accessSync(
      file,
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

export function findCliExecutable(
  name: string,
  configured?: string,
  additionalCandidates: string[] = [],
): string | null {
  if (configured) return isExecutable(configured) ? configured : null;
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error("Invalid CLI name");
  const suffixes =
    process.platform === "win32" ? [".exe", ".cmd", ".bat", ".com"] : [""];
  const candidates = [
    ...additionalCandidates,
    ...installedDirectories().flatMap((directory) =>
      suffixes.map((suffix) => path.join(directory, name + suffix)),
    ),
  ];
  return candidates.find(isExecutable) || null;
}

export function cliEnvironment(executable?: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (key.toUpperCase() === "PATH") delete environment[key];
  const directories = installedDirectories();
  if (executable && path.isAbsolute(executable))
    directories.unshift(path.dirname(executable));
  environment.PATH = [...new Set(directories)].join(path.delimiter);
  return environment;
}

export function windowsSystemExecutable(
  name: "cmd.exe" | "taskkill.exe",
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const root =
    Object.entries(environment).find(
      ([key]) => key.toLowerCase() === "systemroot",
    )?.[1] || "C:\\Windows";
  if (!/^[a-z]:[\\/]/i.test(root) || !path.win32.isAbsolute(root))
    throw new Error("SystemRoot must be an absolute local Windows directory");
  // Do not search the opened repository or PATH for privileged cleanup tools.
  return path.win32.join(root, "System32", name);
}

export function prepareCliCommand(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio = {},
): { command: string; args: string[]; options: SpawnOptionsWithoutStdio } {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command))
    return { command, args, options: { ...options, shell: false } };
  if (
    !path.isAbsolute(command) ||
    /[%\r\n"]/.test(command) ||
    args.some((value) => !/^[a-z0-9_./:=-]+$/i.test(value))
  )
    throw new Error(
      "This batch CLI path or argument cannot be safely quoted. Use an absolute native executable path.",
    );
  const executable = windowsSystemExecutable("cmd.exe");
  return {
    command: executable,
    args: [
      "/d",
      "/v:off",
      "/s",
      "/c",
      `""${command}" ${args.map((value) => `"${value}"`).join(" ")}"`,
    ],
    options: { ...options, shell: false, windowsVerbatimArguments: true },
  };
}
