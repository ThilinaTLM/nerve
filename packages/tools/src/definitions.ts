import type { ToolDescriptor, ToolName, ToolRisk } from "@nerve/shared";
import { type Static, type TSchema, Type } from "typebox";

export type CoreToolExecutionMode = "sequential" | "parallel";

export interface CoreToolDefinition<TParams extends TSchema = TSchema> {
  name: ToolName;
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
      description: "Path to the file to read (relative or absolute).",
    }),
    offset: Type.Optional(
      Type.Number({
        description: "Line number to start reading from (1-indexed).",
      }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Maximum number of lines to read." }),
    ),
  },
  { additionalProperties: false },
);

const listParameters = Type.Object(
  {
    path: Type.Optional(
      Type.String({
        description: "Directory to list. Defaults to the project directory.",
      }),
    ),
    recursive: Type.Optional(
      Type.Boolean({ description: "Whether to recursively list descendants." }),
    ),
    maxEntries: Type.Optional(
      Type.Number({ description: "Maximum number of entries to return." }),
    ),
  },
  { additionalProperties: false },
);

const searchParameters = Type.Object(
  {
    path: Type.Optional(
      Type.String({
        description:
          "Directory or file to search. Defaults to the project directory.",
      }),
    ),
    pattern: Type.String({
      description: "Text or regular expression pattern to search for.",
    }),
    regex: Type.Optional(
      Type.Boolean({
        description: "Treat pattern as a JavaScript regular expression.",
      }),
    ),
    maxResults: Type.Optional(
      Type.Number({
        description: "Maximum number of matching lines to return.",
      }),
    ),
  },
  { additionalProperties: false },
);

const writeParameters = Type.Object(
  {
    path: Type.String({ description: "Path to write (relative or absolute)." }),
    content: Type.String({ description: "UTF-8 file content to write." }),
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

const bashParameters = Type.Object(
  {
    command: Type.String({ description: "Bounded shell command to execute." }),
    cwd: Type.Optional(
      Type.String({
        description: "Working directory relative to the project directory.",
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Number({
        description: "Timeout in milliseconds, capped by the executor.",
      }),
    ),
  },
  { additionalProperties: false },
);

const processStartParameters = Type.Object(
  {
    name: Type.Optional(
      Type.String({
        description: "Stable process name for later stop/restart/log queries.",
      }),
    ),
    command: Type.String({ description: "Long-running command to supervise." }),
    cwd: Type.Optional(
      Type.String({
        description: "Working directory relative to the project directory.",
      }),
    ),
    env: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Additional environment variables.",
      }),
    ),
    readyOnUrl: Type.Optional(
      Type.Boolean({ description: "Mark ready when a URL appears in output." }),
    ),
    readyPattern: Type.Optional(
      Type.String({
        description: "Regex pattern that marks the process ready.",
      }),
    ),
    readyTimeoutMs: Type.Optional(
      Type.Number({ description: "Maximum readiness wait in milliseconds." }),
    ),
  },
  { additionalProperties: false },
);

const processIdOrNameParameters = Type.Object(
  {
    processId: Type.Optional(Type.String({ description: "Process id." })),
    name: Type.Optional(
      Type.String({ description: "Process name within this project." }),
    ),
  },
  { additionalProperties: false },
);

const processStopParameters = Type.Object(
  {
    processId: Type.Optional(Type.String({ description: "Process id." })),
    name: Type.Optional(
      Type.String({ description: "Process name within this project." }),
    ),
    signal: Type.Optional(
      Type.Union(
        [
          Type.Literal("SIGTERM"),
          Type.Literal("SIGINT"),
          Type.Literal("SIGKILL"),
        ],
        {
          description: "Signal to send.",
        },
      ),
    ),
    timeoutMs: Type.Optional(
      Type.Number({ description: "Grace period before escalation." }),
    ),
  },
  { additionalProperties: false },
);

const processListParameters = Type.Object({}, { additionalProperties: false });

const processLogsParameters = Type.Object(
  {
    processId: Type.Optional(Type.String({ description: "Process id." })),
    name: Type.Optional(
      Type.String({ description: "Process name within this project." }),
    ),
    mode: Type.Optional(
      Type.Union([
        Type.Literal("recent"),
        Type.Literal("errors"),
        Type.Literal("warnings"),
        Type.Literal("since_cursor"),
        Type.Literal("first_failure"),
      ]),
    ),
    sinceSeq: Type.Optional(
      Type.Number({ description: "Only return events after this sequence." }),
    ),
    contains: Type.Optional(
      Type.String({ description: "Case-insensitive substring filter." }),
    ),
    regex: Type.Optional(
      Type.String({ description: "Regular expression filter." }),
    ),
    contextLines: Type.Optional(
      Type.Number({ description: "Lines of context around matches." }),
    ),
    limit: Type.Optional(
      Type.Number({ description: "Maximum events to return." }),
    ),
  },
  { additionalProperties: false },
);

const subagentRunParameters = Type.Object(
  {
    task: Type.String({
      description: "Delegated research or review task for the child agent.",
    }),
    mode: Type.Optional(
      Type.Union([Type.Literal("planning"), Type.Literal("coding")]),
    ),
    permissionLevel: Type.Optional(
      Type.Union([
        Type.Literal("read_only"),
        Type.Literal("supervised"),
        Type.Literal("autonomous"),
      ]),
    ),
    workspaceRoots: Type.Optional(
      Type.Array(
        Type.String({
          description: "Workspace root relative to project directory.",
        }),
      ),
    ),
  },
  { additionalProperties: false },
);

export const coreToolDefinitions = [
  {
    name: "read",
    label: "read",
    description:
      "Read UTF-8 file contents. Use offset and limit to continue through large files.",
    promptSnippet: "Read file contents by path.",
    promptGuidelines: ["Use read to examine files instead of cat or sed."],
    parameters: readParameters,
    executionMode: "parallel",
  },
  {
    name: "list",
    label: "list",
    description: "List files and folders, optionally recursively.",
    promptSnippet: "List files and folders.",
    promptGuidelines: [
      "Use list for directory overviews before reading specific files.",
    ],
    parameters: listParameters,
    executionMode: "parallel",
  },
  {
    name: "search",
    label: "search",
    description: "Search file contents by text or regular expression.",
    promptSnippet: "Search file contents for text or regex patterns.",
    promptGuidelines: [
      "Use search to locate symbols, text, and relevant files quickly.",
    ],
    parameters: searchParameters,
    executionMode: "parallel",
  },
  {
    name: "write",
    label: "write",
    description: "Write a UTF-8 file with crash-safe replacement.",
    promptSnippet: "Write complete UTF-8 file contents.",
    promptGuidelines: [
      "Use write only when creating a new file or replacing a whole file intentionally.",
    ],
    parameters: writeParameters,
    executionMode: "sequential",
  },
  {
    name: "edit",
    label: "edit",
    description: "Apply exact targeted text replacements to a UTF-8 file.",
    promptSnippet: "Edit files by exact unique text replacement.",
    promptGuidelines: [
      "Use edit for precise changes. Every oldText must match exactly once.",
      "When changing multiple nearby regions in one file, send them in a single edit call.",
    ],
    parameters: editParameters,
    prepareArguments: prepareEditArguments,
    executionMode: "sequential",
  },
  {
    name: "bash",
    label: "bash",
    description: "Run a bounded shell command in a workspace directory.",
    promptSnippet: "Run bounded shell commands.",
    promptGuidelines: [
      "Use bash for short-lived commands only.",
      "Do not use bash for long-running dev servers or watchers; use process_start instead.",
    ],
    parameters: bashParameters,
    executionMode: "sequential",
  },
  {
    name: "process_start",
    label: "process_start",
    description: "Start a supervised background process and capture logs.",
    promptSnippet: "Start supervised long-running processes and capture logs.",
    promptGuidelines: [
      "Use process_start for dev servers, watchers, daemons, and other long-running commands.",
    ],
    parameters: processStartParameters,
    executionMode: "sequential",
  },
  {
    name: "process_stop",
    label: "process_stop",
    description: "Stop a supervised background process.",
    promptSnippet: "Stop a supervised background process.",
    parameters: processStopParameters,
    executionMode: "sequential",
  },
  {
    name: "process_restart",
    label: "process_restart",
    description: "Restart a supervised background process.",
    promptSnippet: "Restart a supervised background process.",
    parameters: processIdOrNameParameters,
    executionMode: "sequential",
  },
  {
    name: "process_list",
    label: "process_list",
    description: "List supervised background processes for this project.",
    promptSnippet: "List supervised background processes.",
    parameters: processListParameters,
    executionMode: "parallel",
  },
  {
    name: "process_logs",
    label: "process_logs",
    description: "Query captured background process logs.",
    promptSnippet: "Query supervised process logs.",
    promptGuidelines: [
      "Use process_logs to inspect server errors instead of restarting processes blindly.",
    ],
    parameters: processLogsParameters,
    executionMode: "parallel",
  },
  {
    name: "subagent_run",
    label: "subagent_run",
    description: "Run a bounded child agent for delegated research or review.",
    promptSnippet: "Delegate bounded research or review to a child agent.",
    promptGuidelines: [
      "Use subagent_run for independent research tasks when parallel investigation helps.",
    ],
    parameters: subagentRunParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];

export function coreToolDefinitionByName(name: ToolName): CoreToolDefinition {
  const definition = coreToolDefinitions.find((tool) => tool.name === name);
  if (!definition) throw new Error(`Unknown tool: ${name}`);
  return definition;
}

const toolRisks: Record<ToolName, ToolRisk> = {
  read: "read",
  list: "read",
  search: "read",
  write: "workspace_write",
  edit: "workspace_write",
  bash: "command",
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
