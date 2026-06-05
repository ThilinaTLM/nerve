import type {
  CoreToolName,
  ToolDescriptor,
  ToolName,
  ToolRisk,
} from "@nerve/shared";
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

const todoItemParameters = Type.Object(
  {
    todo: Type.String({ description: "The todo item text" }),
    done: Type.Boolean({ description: "Whether the item is done" }),
  },
  { additionalProperties: false },
);

const todosSetParameters = Type.Object(
  {
    todos: Type.Array(todoItemParameters, {
      description: "List of todo items with completion status",
    }),
  },
  { additionalProperties: false },
);

const todosGetParameters = Type.Object({}, { additionalProperties: false });

const webSearchParameters = Type.Object(
  {
    query: Type.String({ description: "The search query" }),
    max_results: Type.Optional(
      Type.Number({
        description: "Maximum number of results (default: 5)",
        minimum: 1,
        maximum: 20,
      }),
    ),
  },
  { additionalProperties: false },
);

const webFetchParameters = Type.Object(
  {
    url: Type.String({ description: "The URL to fetch" }),
    raw: Type.Optional(
      Type.Boolean({
        description:
          "If true, save raw content to a temp file and return the path (default: false)",
      }),
    ),
  },
  { additionalProperties: false },
);

const processStartParameters = Type.Object(
  {
    name: Type.Optional(Type.String({ description: "Stable process name" })),
    cwd: Type.Optional(
      Type.String({ description: "Working directory relative to the project" }),
    ),
    command: Type.String({ description: "Command to start and supervise" }),
    env: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Extra environment variables",
      }),
    ),
    readyOnUrl: Type.Optional(
      Type.Boolean({ description: "Treat first detected URL as ready" }),
    ),
    readyPattern: Type.Optional(
      Type.String({ description: "Regex line that marks the process ready" }),
    ),
    readyTimeoutMs: Type.Optional(
      Type.Number({ description: "Readiness wait timeout in milliseconds" }),
    ),
  },
  { additionalProperties: false },
);

const processTargetParameters = Type.Object(
  {
    processId: Type.Optional(Type.String({ description: "Process id" })),
    name: Type.Optional(Type.String({ description: "Process name" })),
    signal: Type.Optional(
      Type.Union([
        Type.Literal("SIGTERM"),
        Type.Literal("SIGINT"),
        Type.Literal("SIGKILL"),
      ]),
    ),
    timeoutMs: Type.Optional(
      Type.Number({ description: "Stop timeout in milliseconds" }),
    ),
  },
  { additionalProperties: false },
);

const processRestartParameters = Type.Object(
  {
    processId: Type.Optional(Type.String({ description: "Process id" })),
    name: Type.Optional(Type.String({ description: "Process name" })),
  },
  { additionalProperties: false },
);

const processListParameters = Type.Object({}, { additionalProperties: false });

const processLogsParameters = Type.Object(
  {
    processId: Type.Optional(Type.String({ description: "Process id" })),
    name: Type.Optional(Type.String({ description: "Process name" })),
    mode: Type.Optional(
      Type.Union([
        Type.Literal("recent"),
        Type.Literal("errors"),
        Type.Literal("warnings"),
        Type.Literal("since_cursor"),
        Type.Literal("first_failure"),
      ]),
    ),
    sinceSeq: Type.Optional(Type.Number({ description: "Cursor sequence" })),
    contains: Type.Optional(Type.String({ description: "Substring filter" })),
    regex: Type.Optional(Type.String({ description: "Regex filter" })),
    contextLines: Type.Optional(Type.Number({ description: "Context lines" })),
    limit: Type.Optional(Type.Number({ description: "Maximum events" })),
  },
  { additionalProperties: false },
);

const subagentRunParameters = Type.Object(
  {
    task: Type.String({ description: "Task for the child agent" }),
    context: Type.Optional(
      Type.String({ description: "Useful context for the child agent" }),
    ),
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
  },
  { additionalProperties: false },
);

const planModeEnterParameters = Type.Object(
  {
    reason: Type.Optional(
      Type.String({ description: "Why planning mode is needed" }),
    ),
  },
  { additionalProperties: false },
);

const planModePresentParameters = Type.Object(
  {
    file_path: Type.String({
      description: "Path to the markdown plan file inside Nerve plan storage",
    }),
    title: Type.Optional(
      Type.String({ description: "Optional display title" }),
    ),
    summary: Type.Optional(
      Type.String({ description: "Short summary for the review UI" }),
    ),
  },
  { additionalProperties: false },
);

const planModeForceExitParameters = Type.Object(
  {
    reason: Type.Optional(
      Type.String({
        description:
          "Why planning mode should be exited without an accepted plan",
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
      "Read file contents. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, supports offset and limit to continue through large files.",
    promptSnippet: "Read file contents, including image files as attachments",
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
  {
    name: "todos_set",
    label: "Set Todos",
    description:
      "Set the todo list for the current task. Replaces any existing todos. Use this at the start of a complex task to outline the steps.",
    promptSnippet:
      "Set the todo list for the current task, replacing any existing todos",
    parameters: todosSetParameters,
    executionMode: "sequential",
  },
  {
    name: "todos_get",
    label: "Get Todos",
    description: "Get the current todo list with completion status.",
    promptSnippet: "Get the current todo list with completion status",
    parameters: todosGetParameters,
    executionMode: "parallel",
  },
  {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using Tavily. Requires a configured Tavily API key or TAVILY_API_KEY environment variable.",
    promptSnippet: "Search the web for current external information",
    parameters: webSearchParameters,
    executionMode: "parallel",
  },
  {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch the contents of a URL. HTML is converted to markdown for readability. Large responses and binary files are saved to temp storage. Pass raw=true to skip conversion and save the raw content.",
    promptSnippet: "Fetch URL contents; HTML is converted to markdown",
    parameters: webFetchParameters,
    executionMode: "parallel",
  },
] satisfies CoreToolDefinition[];

export const orchestrationToolDefinitions = [
  {
    name: "process_start",
    label: "process_start",
    description:
      "Start a managed long-running command such as a dev server, watcher, or daemon. Captures logs and readiness state for later process_logs queries.",
    promptSnippet:
      "Start long-running commands with supervised logs and lifecycle management",
    promptGuidelines: [
      "Use process_start instead of bash for dev servers, file watchers, queue workers, and other long-running commands.",
      "Provide readyOnUrl or readyPattern when possible so the tool can wait for readiness.",
    ],
    parameters: processStartParameters,
    executionMode: "sequential",
  },
  {
    name: "process_stop",
    label: "process_stop",
    description: "Stop a managed process by processId or name.",
    promptSnippet: "Stop supervised long-running processes",
    parameters: processTargetParameters,
    executionMode: "sequential",
  },
  {
    name: "process_restart",
    label: "process_restart",
    description: "Restart a managed process by processId or name.",
    promptSnippet: "Restart supervised long-running processes",
    parameters: processRestartParameters,
    executionMode: "sequential",
  },
  {
    name: "process_list",
    label: "process_list",
    description: "List managed processes for the current project.",
    promptSnippet: "List supervised processes",
    parameters: processListParameters,
    executionMode: "parallel",
  },
  {
    name: "process_logs",
    label: "process_logs",
    description:
      "Query captured logs from a managed process, including recent output, errors, warnings, cursor-based updates, and first-failure context.",
    promptSnippet: "Inspect logs from supervised processes",
    promptGuidelines: [
      "After code changes that trigger a running process to recompile, inspect process_logs instead of restarting the command just to see errors.",
    ],
    parameters: processLogsParameters,
    executionMode: "parallel",
  },
  {
    name: "subagent_run",
    label: "subagent_run",
    description:
      "Spawn a child agent to investigate an independent task with bounded authority.",
    promptSnippet: "Run a bounded child agent for independent investigation",
    promptGuidelines: [
      "Use subagent_run only for substantial independent investigations, not simple lookups.",
    ],
    parameters: subagentRunParameters,
    executionMode: "sequential",
  },
  {
    name: "plan_mode_enter",
    label: "plan_mode_enter",
    description:
      "Enter planning mode for research and plan preparation before workspace edits. No-op if already in planning mode.",
    promptSnippet: "Enter planning mode before preparing a reviewed plan",
    promptGuidelines: [
      "Use plan_mode_enter from coding mode when the user asks for a plan or when the task needs research before edits.",
    ],
    parameters: planModeEnterParameters,
    executionMode: "sequential",
  },
  {
    name: "plan_mode_present",
    label: "plan_mode_present",
    description:
      "Present a written plan to the user for review and wait for acceptance, change requests, or discard.",
    promptSnippet: "Present a written plan and wait for user review",
    promptGuidelines: [
      "Call plan_mode_present with the plan file path after writing the plan with write/edit and resolving every open question.",
      "Do not implement workspace changes until the plan is accepted.",
    ],
    parameters: planModePresentParameters,
    executionMode: "sequential",
  },
  {
    name: "plan_mode_force_exit",
    label: "plan_mode_force_exit",
    description:
      "Exit planning mode without an accepted plan, recording an explicit reason.",
    promptSnippet: "Force exit planning mode with a reason",
    promptGuidelines: [
      "Use plan_mode_force_exit only when planning should end without an accepted plan.",
    ],
    parameters: planModeForceExitParameters,
    executionMode: "sequential",
  },
] satisfies CoreToolDefinition[];

export const allToolDefinitions = [
  ...coreToolDefinitions,
  ...orchestrationToolDefinitions,
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
  todos_set: "interaction",
  todos_get: "read",
  web_search: "network",
  web_fetch: "network",
  process_start: "command",
  process_stop: "destructive",
  process_restart: "destructive",
  process_list: "read",
  process_logs: "read",
  subagent_run: "agent_spawn",
  plan_mode_enter: "interaction",
  plan_mode_present: "interaction",
  plan_mode_force_exit: "interaction",
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

export function allToolDescriptorsFromDefinitions(): ToolDescriptor[] {
  return allToolDefinitions.map((definition) => ({
    name: definition.name,
    risk: coreToolRiskForName(definition.name),
    description: definition.description,
  }));
}
