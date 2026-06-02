export type ToolExecutionContext = {
  cwd: string;
};

export type ToolExecutionResult = {
  content?: string;
  path?: string;
  entries?: Array<{ path: string; kind: "file" | "directory" | "other" }>;
  matches?: Array<{ path: string; line: number; text: string }>;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export type ToolPathArgs = {
  path?: unknown;
};

export type ReadToolArgs = ToolPathArgs & {
  offset?: unknown;
  limit?: unknown;
};

export type WriteToolArgs = ToolPathArgs & {
  content?: unknown;
};

export type EditToolArgs = ToolPathArgs & {
  edits?: unknown;
  oldText?: unknown;
  newText?: unknown;
};

export type BashToolArgs = {
  command?: unknown;
  timeout?: unknown;
};

export type LsToolArgs = ToolPathArgs & {
  limit?: unknown;
};

export type FindToolArgs = ToolPathArgs & {
  pattern?: unknown;
  limit?: unknown;
};

export type GrepToolArgs = ToolPathArgs & {
  pattern?: unknown;
  glob?: unknown;
  ignoreCase?: unknown;
  literal?: unknown;
  context?: unknown;
  limit?: unknown;
};
