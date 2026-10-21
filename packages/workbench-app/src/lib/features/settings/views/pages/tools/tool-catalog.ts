import { subagentToolNames } from "@nervekit/contracts/tools";
import type { Settings } from "$lib/api";

export type ConfigurableToolName = Settings["tools"]["disabled"][number];

export type ToolSummary = { name: string; description: string };

export type ToolCategory = "core" | "third-party";

export type ToolGroupId =
  | "file-inspection"
  | "file-editing"
  | "plan-present"
  | "todos"
  | "web"
  | "vision"
  | "image-generation"
  | "diagram-export"
  | "process"
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
  ...subagentToolNames,
  "plan_present",
  "web_search",
  "web_fetch",
  "explain_image",
  "generate_image",
  "kroki_export",
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
    id: "shell",
    category: "core",
    label: "Shell",
    description:
      "Run finite shell commands for checks, tests, builds, and project scripts.",
    configurableTools: [],
    tools: [
      {
        name: "bash",
        description:
          "Run shell commands in the foreground or background, with automatic backgrounding or a timeout.",
      },
    ],
  },
  {
    id: "process",
    category: "core",
    label: "Processes",
    description:
      "Inspect background bash runs and run the user's launch definitions.",
    configurableTools: [],
    tools: [
      {
        name: "async_bash",
        description:
          "List background bash runs, read output lines, or stop the process tree.",
      },
      {
        name: "launch",
        description:
          "Inspect, start, restart, stop, or read logs from user-defined launches; definitions cannot be created or edited.",
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
    id: "plan-present",
    category: "core",
    label: "Plan review",
    description:
      "Let the agent submit a plan for your review. Enabled by the Planning profile.",
    configurableTools: ["plan_present"],
    tools: [
      {
        name: "plan_present",
        description:
          "Submit a plan file from plan storage for user review. Ends your turn; approval switches the conversation to the default profile for implementation.",
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
    id: "image-generation",
    category: "third-party",
    label: "Image generation",
    description: "Generate images through the provider configured in Settings.",
    configurableTools: ["generate_image"],
    tools: [
      {
        name: "generate_image",
        description:
          "Generate one image from a text prompt using user-configured settings.",
      },
    ],
  },
  {
    id: "diagram-export",
    category: "third-party",
    label: "Diagram export",
    description:
      "Export diagram source as SVG or PNG through the configured Kroki server.",
    configurableTools: ["kroki_export"],
    tools: [
      {
        name: "kroki_export",
        description:
          "Send diagram source (from a file or inline) to Kroki and save the rendered file to a chosen path or as a tool-call artifact.",
      },
    ],
  },
];
