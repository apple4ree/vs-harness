import { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import {
  monaco,
  languageFor,
  restoreMonacoHoverFactory,
} from "./editor-runtime";
import type { Position, Range } from "../../../shared/language";
import type { Breakpoint } from "../../../shared/execution";
import type {
  SnippetContribution,
  Preferences,
} from "../../../shared/settings";

export type OpenDocument = {
  path: string;
  content: string;
  savedContent: string;
  hash: string;
  conflict?: string;
};
type Props = {
  root: string;
  tabs: OpenDocument[];
  activeTab: OpenDocument | null;
  lineTarget: number | null;
  diagnostics: Record<string, LspDiagnostic[]>;
  fontSize?: number;
  tabSize?: number;
  wordWrap?: boolean;
  theme: Preferences["theme"];
  snippets: SnippetContribution[];
  breakpoints: Breakpoint[];
  debugLocation?: { path?: string; line: number };
  onBreakpoint: (path: string, line: number) => void;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: () => void;
  onReload: (path: string) => void;
  onError: (error: string) => void;
  onDefinition: (path: string, position: Position) => void;
  onReferences: (path: string, position: Position) => void;
  onRename: (path: string, position: Position, currentName: string) => void;
  onActions: (path: string, range: Range) => void;
};
function uriFor(root: string, path: string) {
  return monaco.Uri.from({
    scheme: "witch",
    path: `/${path}`,
    query: new URLSearchParams({ root }).toString(),
  });
}
function toRange(range: Range) {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}
const completionKinds = [
  18, 18, 0, 1, 2, 3, 4, 5, 7, 8, 9, 12, 13, 15, 17, 27, 19, 20, 21, 16, 14, 6,
  10, 11, 23, 24,
];
type ResolvableCompletion = monaco.languages.CompletionItem & {
  witchCompletionId?: string;
  witchModelUri?: string;
  witchModelVersion?: number;
};

export function SourceEditor(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const debugDecorations =
    useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const models = useRef(new Set<monaco.editor.ITextModel>());
  const ownedModels = models.current;
  useEffect(() => {
    const provider = monaco.languages.registerCompletionItemProvider(
      [
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
      ],
      {
        provideCompletionItems(model, position) {
          const current = latest.current;
          if (
            !current.tabs.some(
              (tab) =>
                uriFor(current.root, tab.path).toString() ===
                model.uri.toString(),
            )
          )
            return { suggestions: [] };
          const word = model.getWordUntilPosition(position);
          return {
            suggestions: current.snippets
              .filter((snippet) => snippet.language === model.getLanguageId())
              .map((snippet) => ({
                label: snippet.prefix,
                detail: `Witch snippet · ${snippet.name}`,
                documentation: snippet.description,
                kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: snippet.body,
                insertTextRules:
                  monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range: {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endColumn: word.endColumn,
                },
              })),
          };
        },
      },
    );
    return () => provider.dispose();
  }, []);
  useEffect(() => {
    const provider = monaco.languages.registerCompletionItemProvider(
      ["typescript", "javascript"],
      {
        triggerCharacters: [".", '"', "'", "/", "@"],
        async provideCompletionItems(model, position, _context, token) {
          const current = latest.current;
          const tab = current.tabs.find(
            (item) =>
              uriFor(current.root, item.path).toString() ===
              model.uri.toString(),
          );
          if (!tab || token.isCancellationRequested) return { suggestions: [] };
          const version = model.getVersionId();
          try {
            await window.witch.lsp.change(
              tab.path,
              (tab.content.startsWith("\uFEFF") ? "\uFEFF" : "") +
                model.getValue(),
              current.root,
            );
            const items = await window.witch.lsp.completion(
              tab.path,
              {
                line: position.lineNumber - 1,
                character: position.column - 1,
              },
              current.root,
            );
            if (
              token.isCancellationRequested ||
              model.isDisposed() ||
              version !== model.getVersionId()
            )
              return { suggestions: [] };
            const word = model.getWordUntilPosition(position);
            return {
              incomplete: true,
              suggestions: items.map((item) => ({
                witchCompletionId: item.id,
                witchModelUri: model.uri.toString(),
                witchModelVersion: version,
                label: item.label,
                kind:
                  completionKinds[item.kind || 1] ??
                  monaco.languages.CompletionItemKind.Text,
                detail: item.detail,
                documentation: item.documentation
                  ? { value: item.documentation, isTrusted: false }
                  : undefined,
                insertText: item.insertText || item.label,
                additionalTextEdits: item.additionalTextEdits?.map((edit) => ({
                  range: toRange(edit.range),
                  text: edit.newText,
                })),
                sortText: item.sortText,
                filterText: item.filterText,
                insertTextRules:
                  item.insertTextFormat === 2
                    ? monaco.languages.CompletionItemInsertTextRule
                        .InsertAsSnippet
                    : undefined,
                range: item.range
                  ? toRange(item.range)
                  : {
                      startLineNumber: position.lineNumber,
                      endLineNumber: position.lineNumber,
                      startColumn: word.startColumn,
                      endColumn: word.endColumn,
                    },
              })),
            };
          } catch (error) {
            latest.current.onError(
              `Completion: ${error instanceof Error ? error.message : error}`,
            );
            return { suggestions: [] };
          }
        },
        async resolveCompletionItem(completion: ResolvableCompletion, token) {
          const model = completion.witchModelUri
            ? monaco.editor.getModel(monaco.Uri.parse(completion.witchModelUri))
            : null;
          const valid = () =>
            model &&
            !model.isDisposed() &&
            model.getVersionId() === completion.witchModelVersion &&
            !token.isCancellationRequested;
          if (!completion.witchCompletionId || !valid()) return completion;
          try {
            const resolved = await window.witch.lsp.resolveCompletion(
              completion.witchCompletionId,
            );
            if (!valid()) return completion;
            return {
              ...completion,
              detail: resolved.detail || completion.detail,
              documentation: resolved.documentation
                ? {
                    value: resolved.documentation,
                    isTrusted: false,
                    supportHtml: false,
                  }
                : completion.documentation,
              additionalTextEdits: resolved.additionalTextEdits?.map(
                (edit) => ({ range: toRange(edit.range), text: edit.newText }),
              ),
            };
          } catch {
            // A new keystroke or project switch legitimately expires old suggestions.
            return completion;
          }
        },
      },
    );
    return () => {
      provider.dispose();
      for (const model of ownedModels) {
        if (!model.isDisposed()) model.dispose();
      }
      ownedModels.clear();
    };
  }, [ownedModels]);
  useEffect(() => {
    const markdown = (value?: string) =>
      value ? { value, isTrusted: false, supportHtml: false } : undefined;
    const prepare = async (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
      token: monaco.CancellationToken,
    ) => {
      const current = latest.current;
      const tab = current.tabs.find(
        (item) =>
          uriFor(current.root, item.path).toString() === model.uri.toString(),
      );
      const version = model.getVersionId();
      const valid = () =>
        !token.isCancellationRequested &&
        !model.isDisposed() &&
        model.getVersionId() === version &&
        latest.current.root === current.root;
      if (!tab || !valid()) return null;
      await window.witch.lsp.change(
        tab.path,
        (tab.content.startsWith("\uFEFF") ? "\uFEFF" : "") + model.getValue(),
        current.root,
      );
      return valid()
        ? {
            path: tab.path,
            root: current.root,
            valid,
            position: {
              line: position.lineNumber - 1,
              character: position.column - 1,
            },
          }
        : null;
    };
    const hover = monaco.languages.registerHoverProvider(
      ["typescript", "javascript"],
      {
        async provideHover(model, position, token) {
          try {
            const request = await prepare(model, position, token);
            if (!request) return null;
            const result = await window.witch.lsp.hover(
              request.path,
              request.position,
              request.root,
            );
            if (!request.valid() || !result) return null;
            return {
              contents: result.contents.map((value) => markdown(value)!),
              range: result.range ? toRange(result.range) : undefined,
            };
          } catch {
            // Passive hints should disappear quietly when a document/server expires.
            return null;
          }
        },
      },
    );
    const signatures = monaco.languages.registerSignatureHelpProvider(
      ["typescript", "javascript"],
      {
        signatureHelpTriggerCharacters: ["(", ",", "<"],
        signatureHelpRetriggerCharacters: [")"],
        async provideSignatureHelp(model, position, token, context) {
          try {
            const request = await prepare(model, position, token);
            if (!request) return null;
            const result = await window.witch.lsp.signatureHelp(
              request.path,
              request.position,
              {
                triggerKind: context.triggerKind,
                triggerCharacter: context.triggerCharacter,
                isRetrigger: context.isRetrigger,
              },
              request.root,
            );
            if (!request.valid() || !result) return null;
            return {
              value: {
                ...result,
                signatures: result.signatures.map((signature) => ({
                  ...signature,
                  documentation: markdown(signature.documentation),
                  parameters: signature.parameters.map((parameter) => ({
                    ...parameter,
                    documentation: markdown(parameter.documentation),
                  })),
                })),
              },
              dispose() {},
            };
          } catch {
            return null;
          }
        },
      },
    );
    return () => {
      hover.dispose();
      signatures.dispose();
    };
  }, []);
  useEffect(() => {
    const expected = new Set(
      props.tabs.map((tab) => uriFor(props.root, tab.path).toString()),
    );
    for (const model of ownedModels)
      if (
        !expected.has(model.uri.toString()) &&
        model !== editorRef.current?.getModel()
      ) {
        model.dispose();
        ownedModels.delete(model);
      }
  }, [props.root, props.tabs, ownedModels]);
  function markers() {
    const current = latest.current;
    for (const tab of current.tabs) {
      const model = monaco.editor.getModel(uriFor(current.root, tab.path));
      if (!model) continue;
      ownedModels.add(model);
      monaco.editor.setModelMarkers(
        model,
        "witch-lsp",
        (current.diagnostics[tab.path] || []).map((diagnostic) => ({
          message: diagnostic.message,
          severity:
            diagnostic.severity === 1
              ? monaco.MarkerSeverity.Error
              : diagnostic.severity === 2
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
          ...toRange({ start: diagnostic.start, end: diagnostic.end }),
          source: diagnostic.source,
          code:
            diagnostic.code === undefined ? undefined : String(diagnostic.code),
        })),
      );
    }
  }
  function reveal() {
    const line = latest.current.lineTarget;
    const editor = editorRef.current;
    if (line && editor) {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    }
  }
  function decorateDebugger() {
    const current = latest.current;
    const model = editorRef.current?.getModel();
    if (!model) return;
    const decorations: monaco.editor.IModelDeltaDecoration[] =
      current.breakpoints
        .filter(
          (item) =>
            item.path === current.activeTab?.path &&
            item.line <= model.getLineCount(),
        )
        .map((item) => ({
          range: new monaco.Range(item.line, 1, item.line, 1),
          options: {
            isWholeLine: true,
            glyphMarginClassName: item.verified
              ? "witch-breakpoint"
              : "witch-breakpoint pending",
            glyphMarginHoverMessage: {
              value: item.verified
                ? `Breakpoint${item.actualLine ? ` resolved to line ${item.actualLine}` : ""}`
                : "Breakpoint (pending debugger)",
            },
          },
        }));
    const location = current.debugLocation;
    if (
      location?.path === current.activeTab?.path &&
      location &&
      location.line <= model.getLineCount()
    )
      decorations.push({
        range: new monaco.Range(location.line, 1, location.line, 1),
        options: {
          isWholeLine: true,
          className: "witch-debug-line",
          linesDecorationsClassName: "witch-debug-position",
        },
      });
    debugDecorations.current?.set(decorations);
  }
  useEffect(decorateDebugger, [
    props.activeTab?.path,
    props.breakpoints,
    props.debugLocation,
  ]);
  useEffect(() => {
    markers();
    reveal();
  }, [props.activeTab?.path, props.lineTarget, props.diagnostics]);
  const active = props.activeTab;
  if (!active)
    return (
      <div className="empty-state">
        <span className="constellation-mark">⌘</span>
        <h1>Open a page from your project</h1>
        <p>Ctrl/Cmd+P opens a file. Edits stay local until you save.</p>
      </div>
    );
  return (
    <div className="code-editor">
      <header className="editor-tabs">
        {props.tabs.map((tab) => (
          <div
            key={tab.path}
            className={
              tab.path === active.path ? "editor-tab active" : "editor-tab"
            }
          >
            <button onClick={() => props.onSelect(tab.path)} title={tab.path}>
              {tab.content !== tab.savedContent && (
                <span className="dirty-dot">●</span>
              )}
              {tab.conflict && "⚠ "}
              {tab.path.split("/").at(-1)}
            </button>
            <button
              className="close-tab"
              onClick={() => props.onClose(tab.path)}
              aria-label={`Close ${tab.path}`}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="save-file"
          onClick={props.onSave}
          disabled={active.content === active.savedContent}
        >
          Save
        </button>
      </header>
      <div className="source-breadcrumb">
        {active.path}
        <span>
          F12 Definition · Shift+F12 References · F2 Rename · Ctrl+. Actions
        </span>
      </div>
      {active.conflict && (
        <div className="document-conflict" role="alert">
          <span>{active.conflict} Your buffer has been kept.</span>
          <button onClick={() => props.onReload(active.path)}>
            Review disk version
          </button>
        </div>
      )}
      <Editor
        height="100%"
        path={uriFor(props.root, active.path).toString()}
        language={languageFor(active.path)}
        value={active.content.replace(/^\uFEFF/, "")}
        keepCurrentModel
        saveViewState
        theme={`witch-${props.theme}`}
        onChange={(value) => {
          const current = latest.current;
          if (current.activeTab)
            current.onChange(
              current.activeTab.path,
              (current.activeTab.content.startsWith("\uFEFF") ? "\uFEFF" : "") +
                (value || ""),
            );
        }}
        onMount={(editor) => {
          restoreMonacoHoverFactory();
          editorRef.current = editor;
          debugDecorations.current = editor.createDecorationsCollection();
          editor.onMouseDown((event) => {
            if (
              event.target.type ===
                monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
              event.target.position &&
              latest.current.activeTab
            )
              latest.current.onBreakpoint(
                latest.current.activeTab.path,
                event.target.position.lineNumber,
              );
          });
          editor.addAction({
            id: "witch.toggleBreakpoint",
            label: "Witch: Toggle Breakpoint",
            keybindings: [monaco.KeyCode.F9],
            run: () => {
              const position = editor.getPosition();
              if (position && latest.current.activeTab)
                latest.current.onBreakpoint(
                  latest.current.activeTab.path,
                  position.lineNumber,
                );
            },
          });
          const model = editor.getModel();
          if (model) ownedModels.add(model);
          const location = () => {
            const position = editor.getPosition();
            const tab = latest.current.activeTab;
            return position && tab
              ? {
                  tab,
                  position: {
                    line: position.lineNumber - 1,
                    character: position.column - 1,
                  },
                }
              : null;
          };
          editor.addAction({
            id: "witch.definition",
            label: "Witch: Go to Definition",
            keybindings: [monaco.KeyCode.F12],
            contextMenuGroupId: "navigation",
            run: () => {
              const target = location();
              if (target)
                latest.current.onDefinition(target.tab.path, target.position);
            },
          });
          editor.addAction({
            id: "witch.references",
            label: "Witch: Find References",
            keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12],
            contextMenuGroupId: "navigation",
            run: () => {
              const target = location();
              if (target)
                latest.current.onReferences(target.tab.path, target.position);
            },
          });
          editor.addAction({
            id: "witch.rename",
            label: "Witch: Rename Symbol…",
            keybindings: [monaco.KeyCode.F2],
            contextMenuGroupId: "refactor",
            run: () => {
              const target = location();
              const position = editor.getPosition();
              if (target && position)
                latest.current.onRename(
                  target.tab.path,
                  target.position,
                  editor.getModel()?.getWordAtPosition(position)?.word || "",
                );
            },
          });
          editor.addAction({
            id: "witch.actions",
            label: "Witch: Code Actions…",
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period],
            contextMenuGroupId: "refactor",
            run: () => {
              const target = location();
              const selection = editor.getSelection();
              if (target && selection)
                latest.current.onActions(target.tab.path, {
                  start: {
                    line: selection.startLineNumber - 1,
                    character: selection.startColumn - 1,
                  },
                  end: {
                    line: selection.endLineNumber - 1,
                    character: selection.endColumn - 1,
                  },
                });
            },
          });
          markers();
          reveal();
          decorateDebugger();
        }}
        options={{
          glyphMargin: true,
          minimap: { enabled: false },
          fontSize: props.fontSize || 13,
          fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
          automaticLayout: true,
          scrollBeyondLastLine: false,
          wordWrap: props.wordWrap ? "on" : "off",
          tabSize: props.tabSize || 2,
          padding: { top: 10 },
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}
