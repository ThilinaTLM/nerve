import type {
  CoreToolName,
  ToolDescriptor,
  ToolName,
  ToolRisk,
} from "@nerve/shared";
import { type Static, type TSchema, Type } from "typebox";

export type CoreToolExecutionMode = "sequential" | "parallel";

export interface CoreToolDefinition<TParams extends TSchema = TSchema> {
  name: CoreToolName;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  prepareArguments?: (args: unknown) => Static<TParams>;
  executionMode?: CoreToolExecutionMode;
}

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
  },
  { additionalProperties: false },
);

const bashParameters = Type.Object(
  {
    command: Type.String({ description: "Bash command to execute" }),
    timeout: Type.Optional(
      Type.Number({
        description: "Timeout in seconds, capped by the executor",
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

const editParameters = Type.Object(
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

type EditParameters = Static<typeof editParameters>;

type LegacyEditParameters = EditParameters & {
  oldText?: unknown;
  newText?: unknown;
};

function prepareEditArguments(input: unknown): EditParameters {
  if (!input || typeof input !== "object") return input as EditParameters;
  const args = {
    ...(input as Record<string, unknown>),
  } as LegacyEditParameters;

  if (typeof args.edits === "string") {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) args.edits = parsed as EditParameters["edits"];
    } catch {
      // Let schema validation report the invalid value.
    }
  }

  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    const edits = Array.isArray(args.edits) ? [...args.edits] : [];
    edits.push({ oldText: args.oldText, newText: args.newText });
    const { oldText: _oldText, newText: _newText, ...rest } = args;
    return { ...rest, edits } as EditParameters;
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
        description: "Directory or file to search (default: current directory)",
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

const askUserParameters = Type.Object(
  {
    question: Type.String({
      description: "The single focused free-text question to ask the user",
    }),
    context: Type.Optional(
      Type.String({
        description: "Optional brief background that helps the user answer",
      }),
    ),
    recommendation: Type.Optional(
      Type.String({
        description: "Optional current leaning or recommendation and why",
      }),
    ),
    placeholder: Type.Optional(
      Type.String({
        description: "Optional placeholder text for the reply input",
      }),
    ),
  },
  { additionalProperties: false },
);

export const coreToolDefinitions = [
  {
    name: "read",
    label: "read",
    description:
      "Read file contents. Supports offset and limit to continue through large files.",
    promptSnippet: "Read file contents",
    promptGuidelines: ["Use read to examine files instead of cat or sed."],
    parameters: readParameters,
    executionMode: "parallel",
  },
  {
    name: "bash",
    label: "bash",
    description:
      "Execute a bash command in the current working directory. Returns stdout and stderr. Optionally provide a timeout in seconds.",
    promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
    parameters: bashParameters,
    executionMode: "sequential",
  },
  {
    name: "edit",
    label: "edit",
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    promptSnippet:
      "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
    promptGuidelines: [
      "Use edit for precise changes (edits[].oldText must match exactly)",
      "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
      "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
      "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
    ],
    parameters: editParameters,
    prepareArguments: prepareEditArguments,
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
      "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore when using ripgrep.",
    promptSnippet: "Search file contents for patterns (respects .gitignore)",
    parameters: grepParameters,
    executionMode: "parallel",
  },
  {
    name: "find",
    label: "find",
    description:
      "Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore when using fd.",
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
  {
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user one focused free-text question and wait for their reply. Use only when the answer depends on the user's intent, preference, decision, or unavailable context.",
    promptSnippet: "Ask the user a focused free-text clarification question",
    promptGuidelines: [
      "Use ask_user only when the answer must come from the user rather than the codebase, tools, or prior context.",
      "Ask one focused question at a time. Include brief context and a recommendation when it helps the user answer.",
      "Do not use ask_user for questions you can answer by inspecting files, running tools, or reasoning from existing conversation context.",
    ],
    parameters: askUserParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];

export function coreToolDefinitionByName(
  name: CoreToolName,
): CoreToolDefinition {
  const definition = coreToolDefinitions.find((tool) => tool.name === name);
  if (!definition) throw new Error(`Unknown core tool: ${name}`);
  return definition;
}

const toolRisks: Record<ToolName, ToolRisk> = {
  read: "read",
  bash: "command",
  edit: "workspace_write",
  write: "workspace_write",
  grep: "read",
  find: "read",
  ls: "read",
  ask_user: "interaction",
  process_start: "command",
  process_stop: "destructive",
  process_restart: "destructive",
  process_list: "read",
  process_logs: "read",
  subagent_run: "agent_spawn",
};

export function coreToolRiskForName(name: ToolName): ToolRisk {
  return toolRisks[name] ?? "command";
}

export function coreToolDescriptorsFromDefinitions(): ToolDescriptor[] {
  return coreToolDefinitions.map((definition) => ({
    name: definition.name,
    risk: coreToolRiskForName(definition.name),
    description: definition.description,
  }));
}
