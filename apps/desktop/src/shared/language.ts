export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };
export type Diagnostic = {
  message: string;
  severity?: number;
  start: Position;
  end: Position;
  source?: string;
  code?: string | number;
};
export type LanguageStatus = {
  installed: boolean;
  connected: boolean;
  message: string;
};
export type SourceLocation = { path: string; start: Position; end: Position };
export type HoverInfo = { contents: string[]; range?: Range };
export type SignatureInfo = {
  label: string;
  documentation?: string;
  parameters: { label: string | [number, number]; documentation?: string }[];
  activeParameter?: number;
};
export type SignatureHelpInfo = {
  signatures: SignatureInfo[];
  activeSignature: number;
  activeParameter: number;
};
export type SignatureContext = {
  triggerKind: 1 | 2 | 3;
  triggerCharacter?: string;
  isRetrigger: boolean;
};
export type Completion = {
  id?: string;
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  range?: Range;
  insertTextFormat?: number;
  sortText?: string;
  filterText?: string;
  additionalTextEdits?: { range: Range; newText: string }[];
};
export type BufferChange = { path: string; before: string; after: string };
export type RefactorPreview = { title: string; changes: BufferChange[] };
export type CodeAction = {
  id: string;
  title: string;
  kind?: string;
  disabled?: string;
};
