import { useEffect, useState } from "react";
import {
  COMMANDS,
  DEFAULT_PREFERENCES,
  validatePreferences,
  type CommandId,
  type Preferences,
  type SettingsSnapshot,
} from "../../../shared/settings";
import {
  REMOTE_PROTOCOL_VERSION,
  validateSshProfileDraft,
  type RemoteProfileSnapshot,
  type RemoteStatus,
  type SshProfileDraft,
} from "../../../shared/remote";
import "./settings.css";

const EMPTY_SSH_PROFILE: SshProfileDraft = {
  label: "",
  host: "",
  port: 22,
  connectTimeoutSeconds: 15,
};

export function SettingsDialog({
  snapshot,
  onClose,
}: {
  snapshot: SettingsSnapshot;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<
    "editor" | "shortcuts" | "extensions" | "remote"
  >("editor");
  const [draft, setDraft] = useState<Preferences>(snapshot.preferences);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<RemoteProfileSnapshot>({
    protocol: REMOTE_PROTOCOL_VERSION,
    profiles: [],
    warnings: [],
  });
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null);
  const [sshDraft, setSshDraft] = useState<SshProfileDraft>({
    ...EMPTY_SSH_PROFILE,
  });
  useEffect(
    () => setDraft(snapshot.preferences),
    [JSON.stringify(snapshot.preferences)],
  );
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [busy, onClose]);
  useEffect(() => {
    let disposed = false;
    void Promise.all([window.witch.remote.list(), window.witch.remote.status()])
      .then(([profiles, status]) => {
        if (!disposed) {
          setRemote(profiles);
          setRemoteStatus(status);
        }
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    const off = window.witch.remote.onChanged((profiles) => {
      if (!disposed) setRemote(profiles);
    });
    return () => {
      disposed = true;
      off();
    };
  }, []);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await window.witch.settings.save(validatePreferences(draft));
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function extensionAction(action: () => Promise<SettingsSnapshot>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function remoteAction(action: () => Promise<RemoteProfileSnapshot>) {
    setBusy(true);
    setError("");
    try {
      setRemote(await action());
      return true;
    } catch (reason) {
      setError(String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveSshProfile() {
    if (
      await remoteAction(() =>
        window.witch.remote.saveProfile(validateSshProfileDraft(sshDraft)),
      )
    )
      setSshDraft({ ...EMPTY_SSH_PROFILE });
  }
  return (
    <div className="provider-backdrop">
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Witch settings"
      >
        <header>
          <div>
            <span className="eyebrow">Make the workspace yours</span>
            <h2>Settings</h2>
          </div>
          <button disabled={busy} onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </header>
        <nav aria-label="Settings categories">
          {(["editor", "shortcuts", "extensions", "remote"] as const).map(
            (name) => (
              <button
                key={name}
                className={tab === name ? "selected" : ""}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ),
          )}
        </nav>
        <div className="settings-content">
          {snapshot.warnings.map((warning, index) => (
            <p className="inline-error" key={index}>
              {warning}
            </p>
          ))}
          {tab === "editor" && (
            <>
              <label>
                Theme
                <select
                  aria-label="Theme"
                  value={draft.theme}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      theme: event.target.value as Preferences["theme"],
                    })
                  }
                >
                  <option value="night">Witch Night</option>
                  <option value="twilight">Witch Twilight</option>
                  <option value="contrast">Witch High Contrast</option>
                </select>
              </label>
              <p className="setting-help">Purple, ink, and quiet contrast.</p>
              <label>
                Editor font size
                <input
                  aria-label="Editor font size"
                  type="number"
                  min={10}
                  max={24}
                  value={draft.fontSize}
                  onChange={(event) =>
                    setDraft({ ...draft, fontSize: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Tab size
                <select
                  aria-label="Tab size"
                  value={draft.tabSize}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      tabSize: Number(
                        event.target.value,
                      ) as Preferences["tabSize"],
                    })
                  }
                >
                  {[2, 4, 8].map((value) => (
                    <option key={value} value={value}>
                      {value} spaces
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Word wrap
                <input
                  type="checkbox"
                  aria-label="Word wrap"
                  checked={draft.wordWrap}
                  onChange={(event) =>
                    setDraft({ ...draft, wordWrap: event.target.checked })
                  }
                />
              </label>
              <label>
                Auto save
                <input
                  type="checkbox"
                  aria-label="Auto save"
                  checked={draft.autoSave}
                  onChange={(event) =>
                    setDraft({ ...draft, autoSave: event.target.checked })
                  }
                />
              </label>
              <p className="setting-help">
                Off by default. Auto save pauses for files with unresolved
                external changes.
              </p>
              {draft.autoSave && (
                <label>
                  Auto-save delay (ms)
                  <input
                    aria-label="Auto-save delay"
                    type="number"
                    min={500}
                    max={10000}
                    step={100}
                    value={draft.autoSaveDelay}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        autoSaveDelay: Number(event.target.value),
                      })
                    }
                  />
                </label>
              )}
            </>
          )}
          {tab === "shortcuts" && (
            <>
              <p className="setting-help">
                Mod means Ctrl on Windows and Cmd on macOS. These are
                application shortcuts; editor F2, F9, F12 and debug F5 retain
                their standard actions.
              </p>
              {(Object.entries(COMMANDS) as [CommandId, string][]).map(
                ([id, label]) => (
                  <label key={id}>
                    {label}
                    <input
                      aria-label={`${label} shortcut`}
                      value={draft.keybindings[id]}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          keybindings: {
                            ...draft.keybindings,
                            [id]: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ),
              )}
            </>
          )}
          {tab === "extensions" && (
            <>
              <p className="setting-help">
                Local Witch extensions add declarative snippets. They cannot run
                code, access files, or call services. VS Code VSIX / executable
                extensions are not supported.
              </p>
              <button
                className="primary-action"
                disabled={busy}
                onClick={() =>
                  void extensionAction(() =>
                    window.witch.settings.importExtension(),
                  )
                }
              >
                Import snippet extension
              </button>
              {!snapshot.extensions.length && (
                <p className="setting-help">
                  No extensions installed. A sample manifest is included in
                  examples/extensions.
                </p>
              )}
              {snapshot.extensions.map((extension) => (
                <article className="extension-card" key={extension.id}>
                  <header>
                    <strong>{extension.name}</strong>
                    <span>{extension.version}</span>
                  </header>
                  <small>
                    {extension.id} · {extension.snippets.length} snippets
                  </small>
                  <p>{extension.description}</p>
                  <footer>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void extensionAction(() =>
                          window.witch.settings.toggleExtension(
                            extension.id,
                            !extension.enabled,
                          ),
                        )
                      }
                    >
                      {extension.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void extensionAction(() =>
                          window.witch.settings.removeExtension(extension.id),
                        )
                      }
                    >
                      Remove
                    </button>
                  </footer>
                </article>
              ))}
            </>
          )}
          {tab === "remote" && (
            <>
              <article
                className={`remote-status ${remoteStatus?.ssh.installed ? "ready" : "unavailable"}`}
              >
                <header>
                  <strong>System OpenSSH</strong>
                  <span>
                    {remoteStatus?.ssh.installed ? "Ready" : "Unavailable"}
                  </span>
                </header>
                <p>
                  {remoteStatus?.ssh.message || "Inspecting the SSH client…"}
                </p>
                {remoteStatus?.ssh.version && (
                  <small>{remoteStatus.ssh.version}</small>
                )}
              </article>
              <p className="setting-help">
                Witch stores connection metadata only. Passwords, passphrases,
                and private-key contents remain with OpenSSH, ssh-agent, or your
                operating system.
              </p>
              {remote.warnings.map((warning, index) => (
                <p className="inline-error" key={index}>
                  {warning}
                </p>
              ))}
              <section className="remote-profile-form" aria-label="SSH profile">
                <header>
                  <strong>
                    {sshDraft.id ? "Edit SSH profile" : "New SSH profile"}
                  </strong>
                  {sshDraft.id && (
                    <button
                      disabled={busy}
                      onClick={() => setSshDraft({ ...EMPTY_SSH_PROFILE })}
                    >
                      Cancel edit
                    </button>
                  )}
                </header>
                <label>
                  Label
                  <input
                    aria-label="SSH profile label"
                    placeholder="Research GPU"
                    value={sshDraft.label}
                    onChange={(event) =>
                      setSshDraft({ ...sshDraft, label: event.target.value })
                    }
                  />
                </label>
                <label>
                  Host or SSH config alias
                  <input
                    aria-label="SSH host"
                    placeholder="gpu.example.com"
                    value={sshDraft.host}
                    onChange={(event) =>
                      setSshDraft({ ...sshDraft, host: event.target.value })
                    }
                  />
                </label>
                <div className="remote-profile-grid">
                  <label>
                    User
                    <input
                      aria-label="SSH user"
                      placeholder="optional"
                      value={sshDraft.user || ""}
                      onChange={(event) =>
                        setSshDraft({
                          ...sshDraft,
                          user: event.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label>
                    Port
                    <input
                      aria-label="SSH port"
                      type="number"
                      min={1}
                      max={65535}
                      value={sshDraft.port}
                      onChange={(event) =>
                        setSshDraft({
                          ...sshDraft,
                          port: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <label>
                  Identity file
                  <input
                    aria-label="SSH identity file"
                    placeholder="Optional absolute local path"
                    value={sshDraft.identityFile || ""}
                    onChange={(event) =>
                      setSshDraft({
                        ...sshDraft,
                        identityFile: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label>
                  Connection timeout (seconds)
                  <input
                    aria-label="SSH connection timeout"
                    type="number"
                    min={5}
                    max={120}
                    value={sshDraft.connectTimeoutSeconds}
                    onChange={(event) =>
                      setSshDraft({
                        ...sshDraft,
                        connectTimeoutSeconds: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <button
                  className="primary-action"
                  disabled={busy}
                  onClick={() => void saveSshProfile()}
                >
                  {sshDraft.id ? "Update SSH profile" : "Add SSH profile"}
                </button>
              </section>
              <section
                className="remote-profile-list"
                aria-label="Saved SSH profiles"
              >
                {!remote.profiles.length && (
                  <p className="setting-help">No SSH profiles saved yet.</p>
                )}
                {remote.profiles.map((profile) => (
                  <article className="extension-card" key={profile.id}>
                    <header>
                      <strong>{profile.label}</strong>
                      <span>
                        {profile.user ? `${profile.user}@` : ""}
                        {profile.host}:{profile.port}
                      </span>
                    </header>
                    <p>
                      {profile.identityFile
                        ? "Explicit identity file · "
                        : "OpenSSH config / agent · "}
                      {profile.connectTimeoutSeconds}s timeout
                    </p>
                    <footer>
                      <button
                        disabled={busy}
                        onClick={() => setSshDraft({ ...profile })}
                      >
                        Edit
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void remoteAction(() =>
                            window.witch.remote.removeProfile(profile.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </footer>
                  </article>
                ))}
              </section>
            </>
          )}
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <footer>
          {tab === "remote" ? (
            <>
              <button
                disabled={busy}
                onClick={() => setSshDraft({ ...EMPTY_SSH_PROFILE })}
              >
                New profile
              </button>
              <button
                className="primary-action"
                disabled={busy}
                onClick={onClose}
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={() => setDraft(structuredClone(DEFAULT_PREFERENCES))}
              >
                Reset draft to defaults
              </button>
              <button
                className="primary-action"
                disabled={busy}
                onClick={() => void save()}
              >
                Save settings
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

export function CommandPalette({
  preferences,
  onRun,
  onClose,
}: {
  preferences: Preferences;
  onRun: (command: CommandId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  const commands = (Object.entries(COMMANDS) as [CommandId, string][]).filter(
    ([id, label]) =>
      `${id} ${label}`.toLowerCase().includes(query.toLowerCase()),
  );
  function run(id: CommandId) {
    onClose();
    onRun(id);
  }
  return (
    <div className="provider-backdrop" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          aria-label="Find command"
          placeholder="What would you like to do?"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((value) => Math.min(commands.length - 1, value + 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) => Math.max(0, value - 1));
            }
            if (event.key === "Enter" && commands[selected])
              run(commands[selected][0]);
            if (event.key === "Escape") onClose();
          }}
        />
        <div role="listbox" aria-label="Commands">
          {commands.map(([id, label], index) => (
            <button
              role="option"
              aria-selected={index === selected}
              key={id}
              className={index === selected ? "selected" : ""}
              onMouseEnter={() => setSelected(index)}
              onClick={() => run(id)}
            >
              <span>{label}</span>
              <kbd>{preferences.keybindings[id]}</kbd>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
