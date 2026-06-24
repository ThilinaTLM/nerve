import { type Static, Type } from "typebox";
import type { CoreToolDefinition } from "../types.js";

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

const matchModeParameters = Type.Optional(
  Type.Union(
    [
      Type.Literal("exact"),
      Type.Literal("trimmed"),
      Type.Literal("whitespace"),
    ],
    {
      description:
        "Default exact. trimmed tolerates trailing whitespace and smart punctuation; whitespace collapses whitespace runs.",
    },
  ),
);

const occurrenceParameters = Type.Optional(
  Type.Number({
    description:
      "Optional 1-based match occurrence. If omitted, the match must be unique.",
  }),
);

const replacementParameters = Type.Object(
  {
    oldText: Type.String({
      description:
        "Text to find and replace. Must be non-empty and unique unless occurrence is provided.",
    }),
    newText: Type.String({ description: "Replacement text." }),
    matchMode: matchModeParameters,
    occurrence: occurrenceParameters,
  },
  { additionalProperties: false },
);

const insertionParameters = Type.Object(
  {
    anchor: Type.String({
      description:
        "Text anchor to insert around. Must be non-empty and unique unless occurrence is provided.",
    }),
    position: Type.Union([Type.Literal("before"), Type.Literal("after")], {
      description: "Insert before or after the anchor.",
    }),
    text: Type.String({ description: "Text to insert." }),
    matchMode: matchModeParameters,
    occurrence: occurrenceParameters,
  },
  { additionalProperties: false },
);

const lineReplacementParameters = Type.Object(
  {
    startLine: Type.Number({
      description: "1-based inclusive start line.",
    }),
    endLine: Type.Number({
      description: "1-based inclusive end line.",
    }),
    newText: Type.String({ description: "Replacement text for the range." }),
  },
  { additionalProperties: false },
);

const lineInsertionParameters = Type.Object(
  {
    line: Type.Number({ description: "1-based target line." }),
    position: Type.Union([Type.Literal("before"), Type.Literal("after")], {
      description: "Insert before or after the target line.",
    }),
    text: Type.String({ description: "Text to insert." }),
  },
  { additionalProperties: false },
);

const editParameters = Type.Object(
  {
    path: Type.String({
      description: "Path to the existing file to edit (relative or absolute).",
    }),
    dryRun: Type.Optional(
      Type.Boolean({
        description: "Preview the diff without writing (default false).",
      }),
    ),
    replacements: Type.Optional(
      Type.Array(replacementParameters, {
        minItems: 1,
        description:
          "Exact text replacements resolved against the original file.",
      }),
    ),
    insertions: Type.Optional(
      Type.Array(insertionParameters, {
        minItems: 1,
        description: "Anchor-based text insertions against the original file.",
      }),
    ),
    lineReplacements: Type.Optional(
      Type.Array(lineReplacementParameters, {
        minItems: 1,
        description: "1-based line range replacements.",
      }),
    ),
    lineInsertions: Type.Optional(
      Type.Array(lineInsertionParameters, {
        minItems: 1,
        description: "1-based line insertions.",
      }),
    ),
    patch: Type.Optional(
      Type.String({
        description:
          "Single-file unified diff; cannot combine with edit arrays.",
      }),
    ),
  },
  { additionalProperties: false },
);

type EditParameters = Static<typeof editParameters>;

type EditConvenienceParameters = EditParameters & {
  replacements?: unknown;
  insertions?: unknown;
  lineReplacements?: unknown;
  lineInsertions?: unknown;
};

function parseArrayArgument<T>(value: T): T {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return (Array.isArray(parsed) ? parsed : value) as T;
  } catch {
    return value;
  }
}

function prepareEditArguments(input: unknown): EditParameters {
  if (!input || typeof input !== "object") return input as EditParameters;
  const args = {
    ...(input as Record<string, unknown>),
  } as EditConvenienceParameters;

  const record = args as Record<string, unknown>;
  for (const key of [
    "replacements",
    "insertions",
    "lineReplacements",
    "lineInsertions",
  ]) {
    const parsed = parseArrayArgument(record[key]);
    if (parsed === undefined) delete record[key];
    else record[key] = parsed;
  }

  return args as EditParameters;
}

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
    label: "read",
    description:
      "Read text files or images. Supports line/byte windows; text output is bounded.",
    promptSnippet: "Read file contents, including image files as attachments",
    parameters: readParameters,
    executionMode: "parallel",
  },
  {
    name: "edit",
    label: "edit",
    description:
      "Edit one existing file with replacements, insertions, line edits, or a single-file patch; fails on ambiguous edits.",
    promptSnippet:
      "Make single-file edits with replacements, insertions, line edits, patch, dry-run, matchMode, and occurrence",
    promptGuidelines: [
      "Use edit for existing files; make unique, non-overlapping edits against the original file.",
    ],
    parameters: editParameters,
    prepareArguments: prepareEditArguments,
    executionMode: "sequential",
  },
  {
    name: "write",
    label: "write",
    description:
      "Create or overwrite a file, creating parent directories as needed.",
    promptSnippet: "Create or overwrite files",
    promptGuidelines: ["Use write only for new files or complete rewrites."],
    parameters: writeParameters,
    executionMode: "sequential",
  },
  {
    name: "grep",
    label: "grep",
    description:
      "Search file contents with regex or literal patterns; results are bounded.",
    promptSnippet: "Search file contents for patterns",
    parameters: grepParameters,
    executionMode: "parallel",
  },
  {
    name: "find",
    label: "find",
    description:
      "Find files by glob pattern; results respect .gitignore and are bounded.",
    promptSnippet: "Find files by glob pattern (respects .gitignore)",
    parameters: findParameters,
    executionMode: "parallel",
  },
  {
    name: "ls",
    label: "ls",
    description:
      "List directory entries sorted alphabetically, including dotfiles.",
    promptSnippet: "List directory contents",
    parameters: lsParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
