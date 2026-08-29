import type { Settings } from "$lib/api";

export type ConfigurableToolName = Settings["tools"]["disabled"][number];

export type ToolSummary = { name: string; description: string };

export type ToolCategory = "core" | "third-party";

export type ToolGroupId =
  | "file-inspection"
  | "file-editing"
  | "plan-mode"
  | "todos"
  | "web"
  | "vision"
  | "tasks"
  | "shell"
  | "python";

export type ToolGroupDef = {
  id: ToolGroupId;
  category: ToolCategory;
  label: string;
  description: string;
  tools: ToolSummary[];
  /** Tools toggled together by this group. Empty means always on. */
  configurableTools: ConfigurableToolName[];
};

export const configurableToolOrder: ConfigurableToolName[] = [
  "web_search",
  "web_fetch",
  "explain_image",
  "python_exec",
];

export const toolGroups: ToolGroupDef[] = [
  {
    id: "file-inspection",
    category: "core",
    label: "File inspection",
    description:
      "Read, list, find, and search workspace files without modifying them.",
    configurableTools: [],
    tools: [
      {
        name: "read",
        description: "Read text files or images with bounded output.",
      },
      {
        name: "ls",
        description:
          "List directory entries sorted alphabetically, including dotfiles.",
      },
      {
        name: "find",
        description: "Find files by glob pattern while respecting .gitignore.",
      },
      {
        name: "grep",
        description: "Search file contents with regex or literal patterns.",
      },
    ],
  },
  {
    id: "file-editing",
    category: "core",
    label: "File editing",
    description:
      "Create and modify workspace files when the agent policy permits writes.",
    configurableTools: [],
    tools: [
      {
        name: "write",
        description:
          "Create or overwrite files when workspace writes are allowed.",
      },
      {
        name: "edit",
        description:
          "Patch existing files with replacements, insertions, or diffs.",
      },
    ],
  },
  {
    id: "plan-mode",
    category: "core",
    label: "Plan mode",
    description:
      "Research, draft, and present implementation plans before workspace changes.",
    configurableTools: [],
    tools: [
      {
        name: "plan_mode_enter",
        description: "Enter review-first planning before design-heavy edits.",
      },
      {
        name: "plan_mode_present",
        description: "Present a completed plan for user approval.",
      },
      {
        name: "plan_mode_force_exit",
        description: "Exit plan mode after approval or cancellation.",
      },
    ],
  },
  {
    id: "todos",
    category: "core",
    label: "Todos",
    description:
      "Track multi-step work with a lightweight checklist for the current task.",
    configurableTools: [],
    tools: [
      { name: "todos_set", description: "Set the current task checklist." },
      { name: "todos_get", description: "Read the current task checklist." },
    ],
  },
  {
    id: "tasks",
    category: "core",
    label: "Task management",
    description:
      "Start, supervise, inspect, restart, and cancel background commands.",
    configurableTools: [],
    tools: [
      {
        name: "task_start",
        description: "Start long-lived commands such as servers or watchers.",
      },
      {
        name: "task_status",
        description:
          "Discover background tasks and inspect their current state.",
      },
      {
        name: "task_logs",
        description: "Read recent, warning, error, or filtered task logs.",
      },
      {
        name: "task_control",
        description:
          "Stop or restart a task, preserving saved launch settings on restart.",
      },
    ],
  },
  {
    id: "web",
    category: "third-party",
    label: "Web access",
    description: "Search the web and fetch URLs for external context.",
    configurableTools: ["web_search", "web_fetch"],
    tools: [
      {
        name: "web_search",
        description: "Search the web through Tavily for current information.",
      },
      {
        name: "web_fetch",
        description: "Fetch a URL and convert HTML to readable markdown.",
      },
    ],
  },
  {
    id: "vision",
    category: "third-party",
    label: "Image explanation",
    description:
      "Use a separate vision model to explain images to text-only agents.",
    configurableTools: ["explain_image"],
    tools: [
      {
        name: "explain_image",
        description:
          "Return a detailed text explanation from the configured vision model.",
      },
    ],
  },
  {
    id: "shell",
    category: "core",
    label: "Shell",
    description:
      "Run finite shell commands for checks, tests, builds, and project scripts.",
    configurableTools: [],
    tools: [
      {
        name: "bash",
        description: "Run finite checks, tests, builds, and shell commands.",
      },
    ],
  },
  {
    id: "python",
    category: "core",
    label: "Python",
    description:
      "Run short Python scripts or files for data processing and analysis.",
    configurableTools: ["python_exec"],
    tools: [
      {
        name: "python_exec",
        description: "Run short Python scripts or files for data work.",
      },
    ],
  },
];
