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

const replaceEditParameters = Type.Object(
  {
    oldText: Type.String({
      description:
        "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edit.",
    }),
    newText: Type.String({
      description: "Replacement text for this targeted edit.",
    }),
  },
  { additionalProperties: false },
);

const legacyEditParameters = Type.Object(
  {
    path: Type.String({
      description: "Path to the file to edit (relative or absolute).",
    }),
    edits: Type.Array(replaceEditParameters, {
      description:
        "One or more targeted replacements. Each oldText is matched against the original file, not incrementally. Merge nearby changes into one edit.",
    }),
  },
  { additionalProperties: false },
);

const editOperationParameters = Type.Object(
  {
    type: Type.Union(
      [
        Type.Literal("replace_text"),
        Type.Literal("insert_text"),
        Type.Literal("replace_lines"),
        Type.Literal("insert_lines"),
        Type.Literal("apply_patch"),
      ],
      {
        description:
          "Operation kind: replace_text, insert_text, replace_lines, insert_lines, or apply_patch.",
      },
    ),
    oldText: Type.Optional(
      Type.String({
        description: "replace_text only: text to find and replace.",
      }),
    ),
    newText: Type.Optional(
      Type.String({
        description: "replace_text/replace_lines only: replacement text.",
      }),
    ),
    anchor: Type.Optional(
      Type.String({
        description: "insert_text only: text anchor to insert around.",
      }),
    ),
    position: Type.Optional(
      Type.Union([Type.Literal("before"), Type.Literal("after")], {
        description:
          "insert_text/insert_lines only: insert before or after the target.",
      }),
    ),
    text: Type.Optional(
      Type.String({
        description: "insert_text/insert_lines only: text to insert.",
      }),
    ),
    startLine: Type.Optional(
      Type.Number({
        description: "replace_lines only: 1-based inclusive start line.",
      }),
    ),
    endLine: Type.Optional(
      Type.Number({
        description: "replace_lines only: 1-based inclusive end line.",
      }),
    ),
    line: Type.Optional(
      Type.Number({ description: "insert_lines only: 1-based target line." }),
    ),
    patch: Type.Optional(
      Type.String({
        description: "apply_patch only: single-file unified diff patch.",
      }),
    ),
    matchMode: Type.Optional(
      Type.Union(
        [
          Type.Literal("exact"),
          Type.Literal("trimmed"),
          Type.Literal("whitespace"),
        ],
        {
          description:
            "replace_text/insert_text only. Default exact. trimmed tolerates trailing whitespace and smart punctuation; whitespace collapses whitespace runs.",
        },
      ),
    ),
    occurrence: Type.Optional(
      Type.Number({
        description:
          "replace_text/insert_text only: optional 1-based match occurrence. If omitted, the match must be unique.",
      }),
    ),
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
        description:
          "If true, validate operations and return the diff without writing the file (default false).",
      }),
    ),
    operations: Type.Array(editOperationParameters, {
      minItems: 1,
      description:
        "One or more operations resolved against the original file. apply_patch must be the only operation.",
    }),
  },
  { additionalProperties: false },
);

type LegacyEditParametersSchema = Static<typeof legacyEditParameters>;
type EditParameters = Static<typeof editParameters>;

type LegacyEditConvenienceParameters = LegacyEditParametersSchema & {
  oldText?: unknown;
  newText?: unknown;
};

type EditConvenienceParameters = EditParameters & {
  oldText?: unknown;
  newText?: unknown;
  patch?: unknown;
};

function prepareLegacyEditArguments(
  input: unknown,
): LegacyEditParametersSchema {
  if (!input || typeof input !== "object") {
    return input as LegacyEditParametersSchema;
  }
  const args = {
    ...(input as Record<string, unknown>),
  } as LegacyEditConvenienceParameters;

  if (typeof args.edits === "string") {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) {
        args.edits = parsed as LegacyEditParametersSchema["edits"];
      }
    } catch {
      // Let schema validation report the invalid value.
    }
  }

  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    const edits = Array.isArray(args.edits) ? [...args.edits] : [];
    edits.push({ oldText: args.oldText, newText: args.newText });
    const { oldText: _oldText, newText: _newText, ...rest } = args;
    return { ...rest, edits } as LegacyEditParametersSchema;
  }

  return args as LegacyEditParametersSchema;
}

function prepareEditArguments(input: unknown): EditParameters {
  if (!input || typeof input !== "object") return input as EditParameters;
  const args = {
    ...(input as Record<string, unknown>),
  } as EditConvenienceParameters;

  if (typeof args.operations === "string") {
    try {
      const parsed = JSON.parse(args.operations);
      if (Array.isArray(parsed)) {
        args.operations = parsed as EditParameters["operations"];
      }
    } catch {
      // Let schema validation report the invalid value.
    }
  }

  if (!Array.isArray(args.operations)) {
    if (typeof args.oldText === "string" && typeof args.newText === "string") {
      args.operations = [
        { type: "replace_text", oldText: args.oldText, newText: args.newText },
      ];
    } else if (typeof args.patch === "string") {
      args.operations = [{ type: "apply_patch", patch: args.patch }];
    }
  }

  const { oldText: _oldText, newText: _newText, patch: _patch, ...rest } = args;
  return rest as EditParameters;
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
      "Read file contents. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, supports offset/limit for line windows and byteOffset/byteLimit for overlong lines or minified files. Text output is capped by line count, total byte budget, and per-line length.",
    promptSnippet: "Read file contents, including image files as attachments",
    promptGuidelines: ["Use read to examine files instead of cat or sed."],
    parameters: readParameters,
    executionMode: "parallel",
  },
  {
    name: "edit",
    label: "edit",
    description:
      "Single-file editor with explicit operations. Supports text replacement, anchor insertion, line/range edits, single-file unified patch application, dry-run previews, optional trimmed/whitespace matching, occurrence selection, and ambiguity diagnostics. Fails instead of guessing when matches are missing or ambiguous.",
    promptSnippet:
      "Make single-file edits with explicit operations, dry-run previews, line/range edits, anchors, or single-file patches",
    promptGuidelines: [
      "Use edit for single-file edits.",
      "Prefer replace_text for simple exact replacements.",
      "Use insert_text for anchor insertion.",
      "Use replace_lines / insert_lines when line ranges are clearer.",
      "Use dryRun: true for large or risky edits before applying.",
      'Use matchMode "trimmed" or "whitespace" only when exact matching is impractical.',
      "If edit is ambiguous, do not guess; provide a more specific anchor/oldText, use line ranges, or set an explicit occurrence.",
      "apply_patch is single-file only and must be the only operation.",
    ],
    parameters: editParameters,
    prepareArguments: prepareEditArguments,
    executionMode: "sequential",
  },
  {
    name: "legacy_edit",
    label: "legacy_edit",
    description:
      "Legacy exact-replacement single-file editor. Every edits[].oldText must match a unique, non-overlapping region of the original file.",
    promptSnippet:
      "Use the legacy exact-replacement edit workflow with edits[].oldText/newText",
    promptGuidelines: [
      "Prefer edit for single-file edits; use legacy_edit only when the old { edits: [...] } exact replacement interface is specifically desired.",
      "When changing multiple separate locations in one file, use one legacy_edit call with multiple entries in edits[] instead of multiple calls.",
      "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
      "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
    ],
    parameters: legacyEditParameters,
    prepareArguments: prepareLegacyEditArguments,
    executionMode: "sequential",
  },
  {
    name: "write",
    label: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    promptSnippet: "Create or overwrite files",
    promptGuidelines: ["Use write only for new files or complete rewrites."],
    parameters: writeParameters,
    executionMode: "sequential",
  },
  {
    name: "grep",
    label: "grep",
    description:
      "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore when using ripgrep. Output is capped by match count, total byte budget, and per-line length.",
    promptSnippet: "Search file contents for patterns (respects .gitignore)",
    promptGuidelines: [
      "Use grep.paths when searching multiple files or directories; use grep.path only for one file or directory.",
      "Do not pass multiple paths as one space-separated grep.path string.",
      "Use grep.glob to filter searched files by pattern.",
    ],
    parameters: grepParameters,
    executionMode: "parallel",
  },
  {
    name: "find",
    label: "find",
    description:
      "Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore when using fd. Output is capped by result count, total byte budget, and per-line length.",
    promptSnippet: "Find files by glob pattern (respects .gitignore)",
    parameters: findParameters,
    executionMode: "parallel",
  },
  {
    name: "ls",
    label: "ls",
    description:
      "List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles.",
    promptSnippet: "List directory contents",
    parameters: lsParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];
