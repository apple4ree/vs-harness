import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker?worker";
import CssWorker from "monaco-editor/languages/features/css/css.worker?worker";
import HtmlWorker from "monaco-editor/languages/features/html/html.worker?worker";
import TsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";
// Pinned Monaco 0.56 still captures a disposable diff-editor service in its global hover factory.
// Use the standalone root service after each editor mounts. Regression: review -> close -> completion.
// Upstream: https://github.com/microsoft/monaco-editor/issues/4612
// @ts-expect-error Pinned private module: upstream does not ship internal type declarations.
import { StandaloneServices } from "monaco-editor/editor/standalone/browser/standaloneServices";
// @ts-expect-error Pinned private module for the upstream hover lifecycle workaround.
import { setHoverDelegateFactory } from "monaco-editor/base/browser/ui/hover/hoverDelegateFactory";
// @ts-expect-error Pinned private module for the upstream hover lifecycle workaround.
import { WorkbenchHoverDelegate } from "monaco-editor/platform/hover/browser/hover";
export function restoreMonacoHoverFactory() {
  const root = StandaloneServices.initialize({});
  setHoverDelegateFactory(
    (placement: "mouse" | "element", instantHover: boolean) =>
      root.createInstance(
        WorkbenchHoverDelegate,
        placement,
        { instantHover },
        {},
      ),
  );
}

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === "json") return new JsonWorker();
    if (["css", "scss", "less"].includes(label)) return new CssWorker();
    if (["html", "handlebars", "razor"].includes(label))
      return new HtmlWorker();
    if (["typescript", "javascript"].includes(label)) return new TsWorker();
    return new EditorWorker();
  },
};
// Project-aware intelligence comes from the desktop LSP, not Monaco's isolated-file TS worker.
for (const defaults of [
  monaco.typescript.typescriptDefaults,
  monaco.typescript.javascriptDefaults,
]) {
  defaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  });
  defaults.setModeConfiguration({
    completionItems: false,
    hovers: false,
    documentSymbols: false,
    definitions: false,
    references: false,
    rename: false,
    diagnostics: false,
    documentHighlights: false,
    documentRangeFormattingEdits: false,
    onTypeFormattingEdits: false,
    signatureHelp: false,
    codeActions: false,
    inlayHints: false,
  });
}
monaco.editor.defineTheme("witch-night", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "837594", fontStyle: "italic" },
    { token: "keyword", foreground: "C4A2F5" },
  ],
  colors: {
    "editor.background": "#120d1b",
    "editorLineNumber.foreground": "#645773",
    "editorCursor.foreground": "#dac1ff",
    "editor.selectionBackground": "#6e479966",
    "editor.lineHighlightBackground": "#20152f",
    "editorGutter.background": "#120d1b",
  },
});
monaco.editor.defineTheme("witch-twilight", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "AD9DBF", fontStyle: "italic" },
    { token: "keyword", foreground: "DBC0FF" },
  ],
  colors: {
    "editor.background": "#251b34",
    "editorLineNumber.foreground": "#a591ba",
    "editorCursor.foreground": "#eee0ff",
    "editor.selectionBackground": "#8f62bd66",
    "editor.lineHighlightBackground": "#322442",
    "editorGutter.background": "#251b34",
  },
});
monaco.editor.defineTheme("witch-contrast", {
  base: "hc-black",
  inherit: true,
  rules: [
    { token: "comment", foreground: "C5B5D7" },
    { token: "keyword", foreground: "E2BFFF" },
  ],
  colors: {
    "editor.background": "#08060c",
    "editorLineNumber.foreground": "#c4afdc",
    "editorCursor.foreground": "#ffffff",
    "editor.selectionBackground": "#784aa4",
    "editor.lineHighlightBackground": "#21152f",
    "editorGutter.background": "#08060c",
  },
});
loader.config({ monaco });

export function languageFor(file: string): string {
  const extension = file.split(".").at(-1)?.toLowerCase() || "";
  if (["ts", "tsx", "mts", "cts"].includes(extension)) return "typescript";
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) return "javascript";
  if (["py", "pyi"].includes(extension)) return "python";
  if (extension === "rs") return "rust";
  if (["json", "jsonc"].includes(extension)) return "json";
  if (["md", "mdx"].includes(extension)) return "markdown";
  if (["css", "scss", "less", "html", "xml", "sql", "go"].includes(extension))
    return extension;
  if (["yml", "yaml"].includes(extension)) return "yaml";
  if (["sh", "bash"].includes(extension)) return "shell";
  if (extension === "ps1") return "powershell";
  return "plaintext";
}
export { monaco };
