import { Type } from "typebox";
import { executeEdit } from "../../execution/filesystem/edit.js";
import { executeFind } from "../../execution/filesystem/find.js";
import { executeLs } from "../../execution/filesystem/list.js";
import { executeRead } from "../../execution/filesystem/read.js";
import { executeGrep } from "../../execution/filesystem/search.js";
import { executeWrite } from "../../execution/filesystem/write.js";
import type { ToolDefinition } from "../types.js";

const readParameters = Type.Object(
  {
    path: Type.String({
      description: "Path to the file to read (relative or absolute)",
    }),
    offset: Type.Optional(
      Type.Number({
        description: "Line number to start reading from (1-indexed)",
      }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Maximum number of lines to read" }),
    ),
    byteOffset: Type.Optional(
      Type.Number({
        description:
          "Byte offset to start reading from (0-indexed). Use for overlong lines or minified files; cannot be combined with offset/limit.",
      }),
    ),
    byteLimit: Type.Optional(
      Type.Number({
        description:
          "Maximum number of bytes to read when byteOffset/byteLimit mode is used",
      }),
    ),
  },
  { additionalProperties: false },
);

const editItemParameters = Type.Object(
  {
    oldText: Type.String({
      minLength: 1,
      description: "Exact unique text to replace",
    }),
    newText: Type.String({ description: "Replacement text" }),
  },
  { additionalProperties: false },
);

const editParameters = Type.Object(
  {
    path: Type.String({ description: "Existing file path" }),
    edits: Type.Array(editItemParameters, {
      minItems: 1,
      description: "Exact replacements resolved against the original file",
    }),
  },
  { additionalProperties: false },
);

const writeParameters = Type.Object(
  {
    path: Type.String({ description: "Path to write (relative or absolute)" }),
    content: Type.String({ description: "File content to write" }),
  },
  { additionalProperties: false },
);

const grepParameters = Type.Object(
  {
    pattern: Type.String({
      description: "Search pattern (regex or literal string)",
    }),
    path: Type.Optional(
      Type.String({
        description:
          "Single directory or file to search (default: current directory)",
      }),
    ),
    paths: Type.Optional(
      Type.Array(Type.String({ description: "Directory or file to search" }), {
        description:
          "Multiple directories/files to search. Use this instead of a space-separated path string.",
      }),
    ),
    glob: Type.Optional(
      Type.String({
        description:
          "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'",
      }),
    ),
    ignoreCase: Type.Optional(
      Type.Boolean({ description: "Case-insensitive search (default: false)" }),
    ),
    literal: Type.Optional(
      Type.Boolean({
        description:
          "Treat pattern as literal string instead of regex (default: false)",
      }),
    ),
    context: Type.Optional(
      Type.Number({
        description:
          "Number of lines to show before and after each match (default: 0)",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of matches to return (default: 100)",
      }),
    ),
  },
  { additionalProperties: false },
);

const findParameters = Type.Object(
  {
    pattern: Type.String({
      description:
        "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
    }),
    path: Type.Optional(
      Type.String({
        description: "Directory to search in (default: current directory)",
      }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Maximum number of results (default: 1000)" }),
    ),
  },
  { additionalProperties: false },
);

const lsParameters = Type.Object(
  {
    path: Type.Optional(
      Type.String({
        description: "Directory to list (default: current directory)",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of entries to return (default: 500)",
      }),
    ),
  },
  { additionalProperties: false },
);
export const filesystemToolDefinitions = [
  {
    name: "read",
    group: "fileInspection",
    baseRisk: "read",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "read",
          scope: "exact",
          arguments: ["path"],
        },
      ],
    },
    traits: [],
    executionKind: "local",
    executor: executeRead,
    label: "read",
    description:
      "Read text files or images. Supports line/byte windows; text output is bounded.",
    parameters: readParameters,
    executionMode: "parallel",
  },
  {
    name: "edit",
    group: "fileEditing",
    baseRisk: "workspace_write",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "write",
          scope: "exact",
          arguments: ["path"],
        },
      ],
    },
    traits: ["write_capable"],
    executionKind: "local",
    executor: executeEdit,
    label: "edit",
    description:
      "Replace exact unique text in one existing file; all edits resolve against the original content.",
    parameters: editParameters,
    executionMode: "sequential",
  },
  {
    name: "write",
    group: "fileEditing",
    baseRisk: "workspace_write",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "write",
          scope: "exact",
          arguments: ["path"],
        },
      ],
    },
    traits: ["write_capable"],
    executionKind: "local",
    executor: executeWrite,
    label: "write",
    description:
      "Create or overwrite a file, creating parent directories as needed.",
    parameters: writeParameters,
    executionMode: "sequential",
  },
  {
    name: "grep",
    group: "fileInspection",
    baseRisk: "read",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "read",
          scope: "tree",
          arguments: ["paths", "path"],
          defaultValue: ".",
        },
      ],
    },
    traits: [],
    executionKind: "local",
    executor: executeGrep,
    label: "grep",
    description:
      "Search file contents with regex or literal patterns; results are bounded.",
    parameters: grepParameters,
    executionMode: "parallel",
  },
  {
    name: "find",
    group: "fileInspection",
    baseRisk: "read",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "read",
          scope: "tree",
          arguments: ["path"],
          defaultValue: ".",
        },
      ],
    },
    traits: [],
    executionKind: "local",
    executor: executeFind,
    label: "find",
    description:
      "Find files by glob pattern; results respect .gitignore and are bounded.",
    parameters: findParameters,
    executionMode: "parallel",
  },
  {
    name: "ls",
    group: "fileInspection",
    baseRisk: "read",
    permission: {
      durableAllow: "target",
      targets: [
        {
          kind: "path",
          access: "read",
          scope: "tree",
          arguments: ["path"],
          defaultValue: ".",
        },
      ],
    },
    traits: [],
    executionKind: "local",
    executor: executeLs,
    label: "ls",
    description:
      "List directory entries sorted alphabetically, including dotfiles.",
    parameters: lsParameters,
    executionMode: "parallel",
  },
] satisfies ToolDefinition[];
