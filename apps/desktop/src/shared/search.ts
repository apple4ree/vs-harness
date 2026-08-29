export type TextSearchResult = {
  path: string;
  line: number;
  column: number;
  preview: string;
};
export type SymbolSearchResult = {
  path: string;
  line: number;
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable";
  origin: "typescript-ast" | "python-pattern";
};
export type WorkspaceSearch = {
  query: string;
  text: TextSearchResult[];
  symbols: SymbolSearchResult[];
  scannedFiles: number;
  eligibleFiles: number;
  totalFiles: number;
  truncated: boolean;
  warnings: string[];
};
