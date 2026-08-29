import { DEFAULT_LAYOUT, validateLayout, type PanelLayout } from "./layout";

export const COMMANDS = {
  save: "Save file",
  saveAll: "Save all files",
  quickOpen: "Quick open",
  search: "Search workspace",
  settings: "Open settings",
  openProject: "Open repository",
  commandPalette: "Command palette",
  structure: "Read structure",
} as const;
export type CommandId = keyof typeof COMMANDS;
export type Preferences = {
  theme: "night" | "twilight" | "contrast";
  fontSize: number;
  tabSize: 2 | 4 | 8;
  wordWrap: boolean;
  autoSave: boolean;
  autoSaveDelay: number;
  keybindings: Record<CommandId, string>;
  layout: PanelLayout;
};
export const DEFAULT_PREFERENCES: Preferences = {
  theme: "night",
  fontSize: 13,
  tabSize: 2,
  wordWrap: false,
  autoSave: false,
  autoSaveDelay: 1500,
  layout: { ...DEFAULT_LAYOUT },
  keybindings: {
    save: "Mod+S",
    saveAll: "Mod+Shift+S",
    quickOpen: "Mod+P",
    search: "Mod+Shift+F",
    settings: "Mod+,",
    openProject: "Mod+O",
    commandPalette: "Mod+Shift+P",
    structure: "Mod+Shift+G",
  },
};
export type SnippetContribution = {
  name: string;
  language: string;
  prefix: string;
  body: string;
  description?: string;
};
export type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  snippets: SnippetContribution[];
};
export type InstalledExtension = ExtensionManifest & { enabled: boolean };
export type SettingsSnapshot = {
  preferences: Preferences;
  extensions: InstalledExtension[];
  warnings: string[];
};

export function normalizeShortcut(value: unknown): string {
  if (typeof value !== "string" || value.length > 50)
    throw new Error("Invalid shortcut");
  const parts = value.split("+").map((part) => part.trim());
  const key = parts.pop()!;
  const aliases: Record<string, string> = {
    mod: "Mod",
    ctrl: "Ctrl",
    meta: "Meta",
    alt: "Alt",
    shift: "Shift",
  };
  const modifiers = parts.map((part) => aliases[part.toLowerCase()]);
  if (
    modifiers.some((value) => !value) ||
    new Set(modifiers).size !== modifiers.length ||
    !/^([a-z0-9,./;\[\]`-]|F([1-9]|1[0-2]))$/i.test(key)
  )
    throw new Error("Use a shortcut such as Mod+Shift+P or Alt+K");
  if (
    !modifiers.length ||
    (modifiers.includes("Mod") &&
      (modifiers.includes("Ctrl") || modifiers.includes("Meta")))
  )
    throw new Error(
      "Use Mod for Ctrl on Windows / Cmd on macOS, or explicit modifiers",
    );
  return [
    ...["Mod", "Ctrl", "Meta", "Alt", "Shift"].filter((modifier) =>
      modifiers.includes(modifier),
    ),
    key.length === 1 ? key.toUpperCase() : key.toUpperCase(),
  ].join("+");
}
export function shortcutMatches(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
  shortcut: string,
  mac: boolean,
): boolean {
  const parts = shortcut.split("+"),
    key = parts.pop()!;
  const ctrl = parts.includes("Ctrl") || (parts.includes("Mod") && !mac);
  const meta = parts.includes("Meta") || (parts.includes("Mod") && mac);
  return (
    event.key.toUpperCase() === key.toUpperCase() &&
    event.ctrlKey === ctrl &&
    event.metaKey === meta &&
    event.altKey === parts.includes("Alt") &&
    event.shiftKey === parts.includes("Shift")
  );
}
export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Settings must be an object");
  const source = value as Preferences;
  if (
    !["night", "twilight", "contrast"].includes(source.theme) ||
    !Number.isInteger(source.fontSize) ||
    source.fontSize < 10 ||
    source.fontSize > 24 ||
    ![2, 4, 8].includes(source.tabSize) ||
    typeof source.wordWrap !== "boolean" ||
    typeof source.autoSave !== "boolean" ||
    !Number.isInteger(source.autoSaveDelay) ||
    source.autoSaveDelay < 500 ||
    source.autoSaveDelay > 10000
  )
    throw new Error("Invalid editor preferences");
  const keybindings = Object.fromEntries(
    Object.keys(COMMANDS).map((command) => [
      command,
      normalizeShortcut(source.keybindings?.[command as CommandId]),
    ]),
  ) as Record<CommandId, string>;
  for (const mac of [false, true]) {
    const effective = Object.values(keybindings).map((shortcut) =>
      shortcut
        .replace("Mod+", mac ? "Meta+" : "Ctrl+")
        .split("+")
        .sort()
        .join("+"),
    );
    if (new Set(effective).size !== Object.keys(COMMANDS).length)
      throw new Error(
        "Two commands cannot use the same shortcut on Windows or macOS",
      );
  }
  return {
    theme: source.theme,
    fontSize: source.fontSize,
    tabSize: source.tabSize,
    wordWrap: source.wordWrap,
    autoSave: source.autoSave,
    autoSaveDelay: source.autoSaveDelay,
    layout: validateLayout(source.layout),
    keybindings,
  };
}
export function validateExtension(value: unknown): ExtensionManifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Extension manifest must be an object");
  const manifest = value as ExtensionManifest;
  if (
    typeof manifest.id !== "string" ||
    !/^([a-z][a-z0-9-]*\.)+[a-z][a-z0-9-]*$/.test(manifest.id) ||
    manifest.id.length > 100
  )
    throw new Error("Extension id must use publisher.name format");
  if (
    typeof manifest.name !== "string" ||
    !manifest.name.trim() ||
    manifest.name.length > 80 ||
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version)
  )
    throw new Error("Extension name and semantic version are required");
  if (!Array.isArray(manifest.snippets) || manifest.snippets.length > 100)
    throw new Error("Extensions support up to 100 declarative snippets");
  if ("main" in value || "scripts" in value || "activationEvents" in value)
    throw new Error(
      "Executable extensions are not supported. Witch extensions are declarative snippets only.",
    );
  const languages = new Set([
    "typescript",
    "javascript",
    "python",
    "json",
    "html",
    "css",
    "markdown",
    "shell",
    "powershell",
    "plaintext",
    "go",
    "rust",
  ]);
  const snippets = manifest.snippets.map((snippet) => {
    if (
      !snippet ||
      typeof snippet.name !== "string" ||
      !snippet.name.trim() ||
      snippet.name.length > 100 ||
      !languages.has(snippet.language) ||
      typeof snippet.prefix !== "string" ||
      !snippet.prefix.trim() ||
      snippet.prefix.length > 50 ||
      typeof snippet.body !== "string" ||
      snippet.body.length > 10000
    )
      throw new Error("Invalid snippet contribution");
    return {
      name: snippet.name,
      language: snippet.language,
      prefix: snippet.prefix,
      body: snippet.body,
      description:
        typeof snippet.description === "string"
          ? snippet.description.slice(0, 500)
          : undefined,
    };
  });
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description:
      typeof manifest.description === "string"
        ? manifest.description.slice(0, 500)
        : undefined,
    snippets,
  };
}
