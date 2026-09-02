export const REMOTE_PROTOCOL_VERSION = "witch.remote/v1" as const;

export type SshProfile = {
  id: string;
  label: string;
  host: string;
  port: number;
  user?: string;
  identityFile?: string;
  connectTimeoutSeconds: number;
};

export type SshProfileDraft = Omit<SshProfile, "id"> & { id?: string };

export type RemoteProfileSnapshot = {
  protocol: typeof REMOTE_PROTOCOL_VERSION;
  profiles: SshProfile[];
  warnings: string[];
};

export type SshClientStatus = {
  installed: boolean;
  executable?: string;
  version?: string;
  message: string;
};

export type RemoteStatus = {
  protocol: typeof REMOTE_PROTOCOL_VERSION;
  ssh: SshClientStatus;
};

function cleanOptional(value: unknown, maximum: number, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value ||
    value.length > maximum ||
    /[\0\r\n]/.test(value)
  )
    throw new Error(`Invalid SSH ${field}`);
  return value;
}

export function validateSshProfileDraft(value: unknown): SshProfileDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("SSH profile must be an object");
  const source = value as Record<string, unknown>;
  for (const secret of ["password", "passphrase", "privateKey", "key"])
    if (secret in source)
      throw new Error("Witch does not store SSH passwords or private keys");
  const id = cleanOptional(source.id, 100, "profile id");
  if (id && !/^[a-f0-9-]{16,100}$/i.test(id))
    throw new Error("Invalid SSH profile id");
  const label = cleanOptional(source.label, 80, "profile label");
  if (!label) throw new Error("SSH profile label is required");
  const host = cleanOptional(source.host, 255, "host");
  if (
    !host ||
    !/^[a-z0-9:][a-z0-9._:-]*$/i.test(host) ||
    !/[a-z0-9]/i.test(host) ||
    host.startsWith("-")
  )
    throw new Error("Use an SSH host name, IP address, or config alias");
  const user = cleanOptional(source.user, 64, "user");
  if (user && !/^[a-z0-9._-]+$/i.test(user))
    throw new Error("Invalid SSH user");
  const identityFile = cleanOptional(
    source.identityFile,
    1000,
    "identity file",
  );
  const port = source.port === undefined ? 22 : Number(source.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SSH port must be between 1 and 65535");
  const connectTimeoutSeconds =
    source.connectTimeoutSeconds === undefined
      ? 15
      : Number(source.connectTimeoutSeconds);
  if (
    !Number.isInteger(connectTimeoutSeconds) ||
    connectTimeoutSeconds < 5 ||
    connectTimeoutSeconds > 120
  )
    throw new Error("SSH connection timeout must be between 5 and 120 seconds");
  return {
    ...(id ? { id } : {}),
    label,
    host,
    port,
    ...(user ? { user } : {}),
    ...(identityFile ? { identityFile } : {}),
    connectTimeoutSeconds,
  };
}
