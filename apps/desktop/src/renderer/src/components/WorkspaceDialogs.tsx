import { useEffect, useRef, useState } from "react";
export type FileActionKind =
  "create-file" | "create-folder" | "rename" | "move" | "delete";
export type FileAction = {
  kind: FileActionKind;
  source?: string;
  initialPath: string;
};

export function QuickOpenDialog({
  files,
  query,
  onQueryChange,
  onClose,
  onSelect,
}: {
  files: FileEntry[];
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    resultsRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div
      className="provider-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="provider-dialog navigation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-open-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">Witch navigation</span>
            <h1 id="quick-open-title">Quick open</h1>
          </div>
          <button
            className="close-provider"
            onClick={onClose}
            aria-label="Close quick open"
          >
            ×
          </button>
        </header>
        <input
          ref={inputRef}
          className="navigation-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Type a file path…"
          aria-label="Quick open file"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="quick-open-results"
          aria-activedescendant={
            files[selected] ? `quick-open-result-${selected}` : undefined
          }
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) =>
                Math.max(
                  0,
                  Math.min(
                    files.length - 1,
                    value + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            } else if (event.key === "Enter" && files[selected]) {
              event.preventDefault();
              onSelect(files[selected].path);
            } else if (event.key === "Escape") onClose();
          }}
        />
        <p className="navigation-hint">
          {files.length
            ? `${files.length} local files shown · ↑↓ to choose · Enter to open`
            : "No matching files in the opened project."}
        </p>
        <div
          className="navigation-results"
          id="quick-open-results"
          role="listbox"
          aria-label="Matching files"
          ref={resultsRef}
        >
          {files.map((file, index) => (
            <button
              key={file.path}
              id={`quick-open-result-${index}`}
              role="option"
              aria-selected={selected === index}
              onMouseEnter={() => setSelected(index)}
              onClick={() => onSelect(file.path)}
            >
              <strong>{file.path.split("/").at(-1)}</strong>
              <small>{file.path}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function WorkspaceSearchDialog({
  query,
  result,
  searching,
  onQueryChange,
  onSearch,
  onClose,
  onSelect,
}: {
  query: string;
  result: WorkspaceSearch | null;
  searching: boolean;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onClose: () => void;
  onSelect: (path: string, line: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div
      className="provider-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="provider-dialog navigation-dialog workspace-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-search-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header>
          <div>
            <span className="eyebrow">Local code index</span>
            <h1 id="workspace-search-title">Search workspace</h1>
          </div>
          <button
            className="close-provider"
            onClick={onClose}
            aria-label="Close workspace search"
          >
            ×
          </button>
        </header>
        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <input
            ref={inputRef}
            className="navigation-input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Find text or symbol name…"
            aria-label="Search workspace"
          />
          <button disabled={searching || !query.trim()}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
        {result && (
          <p className="navigation-hint">
            {result.symbols.length} symbols · {result.text.length} text matches
            · {result.scannedFiles}/{result.eligibleFiles} eligible text files
            read
          </p>
        )}
        {result?.warnings.length ? (
          <div className="search-warnings" role="status">
            {result.warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </div>
        ) : null}
        <div className="search-results">
          {result && (
            <>
              <section>
                <h2>
                  Symbols <small>TS/JS declarations · Python patterns</small>
                </h2>
                {result.symbols.length ? (
                  result.symbols.map((symbol) => (
                    <button
                      key={`${symbol.path}:${symbol.line}:${symbol.name}`}
                      title={
                        symbol.origin === "typescript-ast"
                          ? "TypeScript / JavaScript syntax tree"
                          : "Python declaration pattern (not a language server)"
                      }
                      onClick={() => onSelect(symbol.path, symbol.line)}
                    >
                      <span className="symbol-kind">{symbol.kind}</span>
                      <strong>{symbol.name}</strong>
                      <small>
                        {symbol.path}:{symbol.line}
                      </small>
                    </button>
                  ))
                ) : (
                  <p className="empty">No matching symbols.</p>
                )}
              </section>
              <section>
                <h2>Text matches</h2>
                {result.text.length ? (
                  result.text.map((match) => (
                    <button
                      key={`${match.path}:${match.line}:${match.column}`}
                      onClick={() => onSelect(match.path, match.line)}
                    >
                      <strong>
                        {match.path}:{match.line}:{match.column}
                      </strong>
                      <small>{match.preview}</small>
                    </button>
                  ))
                ) : (
                  <p className="empty">No matching text.</p>
                )}
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export function FileActionDialog({
  action,
  onClose,
  onSubmit,
}: {
  action: FileAction;
  onClose: () => void;
  onSubmit: (path: string) => void;
}) {
  const [pathValue, setPathValue] = useState(action.initialPath);
  const inputRef = useRef<HTMLInputElement>(null);
  const labels: Record<
    FileActionKind,
    { eyebrow: string; title: string; action: string; help: string }
  > = {
    "create-file": {
      eyebrow: "Workspace files",
      title: "Create file",
      action: "Create file",
      help: "Enter a path relative to the opened project. Parent folders must already exist.",
    },
    "create-folder": {
      eyebrow: "Workspace files",
      title: "Create folder",
      action: "Create folder",
      help: "Enter a path relative to the opened project. Parent folders must already exist.",
    },
    rename: {
      eyebrow: "Workspace files",
      title: "Rename file or folder",
      action: "Rename",
      help: "Enter the new relative path. Keep the same folder to rename only.",
    },
    move: {
      eyebrow: "Workspace files",
      title: "Move file or folder",
      action: "Move",
      help: "Enter a destination relative to the opened project. The destination folder must exist.",
    },
    delete: {
      eyebrow: "Workspace files",
      title: "Delete path",
      action: "Move to trash",
      help: "Move a file or folder to the operating system’s Trash or Recycle Bin after confirmation. It can be recovered there.",
    },
  };
  const label = labels[action.kind];
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <div
      className="provider-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="provider-dialog file-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-action-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header>
          <div>
            <span className="eyebrow">{label.eyebrow}</span>
            <h1 id="file-action-title">{label.title}</h1>
          </div>
          <button
            className="close-provider"
            onClick={onClose}
            aria-label={`Close ${label.title}`}
          >
            ×
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(pathValue);
          }}
        >
          <p>{label.help}</p>
          <label htmlFor="workspace-path">Workspace-relative path</label>
          <input
            ref={inputRef}
            id="workspace-path"
            value={pathValue}
            onChange={(event) => setPathValue(event.target.value)}
            placeholder="src/example.ts"
            spellCheck={false}
            autoComplete="off"
          />
          <footer>
            <span>
              {action.source
                ? `Selected source: ${action.source}`
                : "The opened project root is protected and cannot be changed."}
            </span>
            <button
              className={
                action.kind === "delete" ? "danger-action" : "primary-action"
              }
              disabled={!pathValue.trim()}
            >
              {label.action}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function ProviderDialog({
  providers,
  onClose,
  onSave,
  onRemove,
}: {
  providers: ProviderStatus | null;
  onClose: () => void;
  onSave: (provider: ApiProviderId, key: string) => Promise<void>;
  onRemove: (provider: ApiProviderId) => Promise<void>;
}) {
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [busy, setBusy] = useState<ApiProviderId | null>(null);
  const [error, setError] = useState("");

  async function save(provider: ApiProviderId) {
    const key = provider === "openai" ? openaiKey : anthropicKey;
    setBusy(provider);
    setError("");
    try {
      await onSave(provider, key);
      if (provider === "openai") setOpenaiKey("");
      else setAnthropicKey("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save the API key",
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: ApiProviderId) {
    setBusy(provider);
    setError("");
    try {
      await onRemove(provider);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to remove the API key",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="provider-backdrop" role="presentation">
      <section
        className="provider-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="providers-title"
      >
        <header>
          <div>
            <span className="eyebrow">Witch connections</span>
            <h1 id="providers-title">AI providers</h1>
          </div>
          <button
            className="close-provider"
            onClick={onClose}
            aria-label="Close AI provider settings"
          >
            ×
          </button>
        </header>
        <p className="provider-intro">
          Witch is an independent ADE. It can reuse a CLI account you already
          signed into, or keep an encrypted API key on this computer for a
          future direct API adapter.
        </p>
        <div className="provider-grid">
          <article className="provider-card">
            <header>
              <h2>Codex CLI</h2>
              <span
                className={
                  providers?.codex.installed
                    ? "provider-state connected"
                    : "provider-state"
                }
              >
                {providers?.codex.installed ? "detected" : "missing"}
              </span>
            </header>
            <p>{providers?.codex.message || "Checking Codex…"}</p>
            {providers?.codex.version && (
              <small>{providers.codex.version}</small>
            )}
            <strong>Current engine</strong>
            <small>
              Witch starts the local App Server and reuses its existing Codex
              sign-in. No token is copied into Witch.
            </small>
          </article>
          <article className="provider-card">
            <header>
              <h2>Claude Code CLI</h2>
              <span
                className={
                  providers?.claude.installed
                    ? "provider-state connected"
                    : "provider-state"
                }
              >
                {providers?.claude.installed ? "detected" : "missing"}
              </span>
            </header>
            <p>{providers?.claude.message || "Checking Claude Code…"}</p>
            {providers?.claude.version && (
              <small>{providers.claude.version}</small>
            )}
            <strong>Planned adapter</strong>
            <small>
              When enabled, it will reuse the CLI’s existing sign-in just like
              Codex.
            </small>
          </article>
          <ApiKeyCard
            title="OpenAI API"
            provider="openai"
            status={providers?.openaiApi}
            value={openaiKey}
            onChange={setOpenaiKey}
            busy={busy === "openai"}
            onSave={() => save("openai")}
            onRemove={() => remove("openai")}
          />
          <ApiKeyCard
            title="Anthropic API"
            provider="anthropic"
            status={providers?.anthropicApi}
            value={anthropicKey}
            onChange={setAnthropicKey}
            busy={busy === "anthropic"}
            onSave={() => save("anthropic")}
            onRemove={() => remove("anthropic")}
          />
        </div>
        {error && <p className="provider-error">{error}</p>}
        <footer>
          <span>
            Keys use operating-system encryption through Electron safeStorage
            (Windows DPAPI or macOS Keychain). Witch never displays a saved key
            again.
          </span>
          <button className="primary-action" onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}

function ApiKeyCard({
  title,
  provider,
  status,
  value,
  onChange,
  busy,
  onSave,
  onRemove,
}: {
  title: string;
  provider: ApiProviderId;
  status?: ApiProviderStatus;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  onSave: () => void;
  onRemove: () => void;
}) {
  const ready = status?.configured;
  return (
    <article className="provider-card">
      <header>
        <h2>{title}</h2>
        <span className={ready ? "provider-state connected" : "provider-state"}>
          {ready ? "stored" : "optional"}
        </span>
      </header>
      <p>{status?.message || "Checking secure storage…"}</p>
      {status?.updatedAt && (
        <small>Updated {new Date(status.updatedAt).toLocaleString()}</small>
      )}
      <label htmlFor={`${provider}-api-key`}>API key</label>
      <input
        id={`${provider}-api-key`}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder={
          ready
            ? "Enter a replacement key"
            : "Paste a key to enable future direct API use"
        }
        disabled={busy || !status?.encryptionAvailable}
      />
      <div className="provider-actions">
        <button
          onClick={onSave}
          disabled={busy || !value || !status?.encryptionAvailable}
        >
          {busy ? "Saving…" : "Save securely"}
        </button>
        {ready && (
          <button className="quiet-action" onClick={onRemove} disabled={busy}>
            Remove
          </button>
        )}
      </div>
      <small>
        Stored metadata only is visible here; direct API requests are not
        enabled in this milestone.
      </small>
    </article>
  );
}
