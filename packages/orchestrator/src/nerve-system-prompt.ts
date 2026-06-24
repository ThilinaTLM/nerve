import { formatSkillsForSystemPrompt, type Skill } from "@nerve/agent";
import { promptText } from "./prompt-text.js";

export interface BuildNerveSystemPromptOptions {
  customPrompt?: string;
  selectedTools?: string[];
  promptGuidelines?: string[];
  appendSystemPrompt?: string;
  cwd: string;
  mode?: "planning" | "coding";
  planDir?: string;
  contextFiles?: Array<{ path: string; content: string }>;
  skills?: Skill[];
}

export function buildNerveSystemPrompt(
  options: BuildNerveSystemPromptOptions,
): string {
  const cwd = options.cwd.replace(/\\/g, "/");
  const date = currentDate();
  const tools = options.selectedTools ?? ["read", "bash", "edit", "write"];
  const hasRead = tools.includes("read");

  const basePrompt = options.customPrompt?.trim()
    ? options.customPrompt
    : defaultPrompt({
        selectedTools: tools,
        promptGuidelines: options.promptGuidelines ?? [],
        mode: options.mode,
      });

  const skillsBlock =
    hasRead && (options.skills?.length ?? 0) > 0
      ? formatSkillsForSystemPrompt(options.skills ?? [])
      : "";

  const planModeBlock =
    options.mode === "planning"
      ? buildPlanModeInstructions(options.planDir ?? "Nerve plan storage")
      : "";
  const environmentBlock = formatEnvironment({ date, cwd });

  return [
    basePrompt,
    options.appendSystemPrompt,
    planModeBlock,
    formatProjectInstructions(options.contextFiles ?? []),
    skillsBlock,
    environmentBlock,
  ]
    .filter((section): section is string => Boolean(section?.trim()))
    .join("\n\n");
}

function defaultPrompt(options: {
  selectedTools: string[];
  promptGuidelines: string[];
  mode?: "planning" | "coding";
}): string {
  const toolRules: string[] = [];
  const seen = new Set<string>();
  const addToolRule = (value: string) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    toolRules.push(normalized);
  };

  const activeTools = new Set(options.selectedTools);
  if (
    activeTools.has("bash") &&
    (!activeTools.has("grep") ||
      !activeTools.has("find") ||
      !activeTools.has("ls"))
  ) {
    addToolRule(
      "Use bash for file listing/search only when dedicated grep/find/ls tools are unavailable.",
    );
  }
  for (const guideline of options.promptGuidelines) addToolRule(guideline);
  if (options.mode !== "planning" && activeTools.has("plan_mode_enter")) {
    addToolRule(
      "Enter plan mode before requested plans or design-heavy edits.",
    );
  }

  return promptText`
    You are Nerve's coding agent. Work in the current project, use tools safely, and keep responses concise.

    ${formatToolsBlock(options.selectedTools)}

    Tool schemas are authoritative for arguments and capabilities.

    ${formatTaggedBulletSection("tool_rules", combineRelatedToolRules(toolRules))}

    <working_rules>
    - Keep going until the task is done or blocked by a user decision.
    - After each tool result, choose the next concrete action.
    - Final responses should summarize changes, validation, and remaining limits.
    - Show file paths clearly when discussing files.
    </working_rules>
  `;
}

function formatToolsBlock(selectedTools: string[]): string {
  const tools = selectedTools.length > 0 ? selectedTools.join(", ") : "none";
  return ["<tools>", tools, "</tools>"].join("\n");
}

function combineRelatedToolRules(items: string[]): string[] {
  const finiteBashRule = "Use bash for finite checks, tests, and builds.";
  const taskStartRule =
    "Use task_start for servers, watchers, and other long-lived processes.";
  if (!items.includes(finiteBashRule) || !items.includes(taskStartRule)) {
    return items;
  }

  const combinedRule =
    "Use bash for finite checks, tests, and builds; use task_start for servers, watchers, and other long-lived processes.";
  let inserted = false;
  const combined: string[] = [];
  for (const item of items) {
    if (item !== finiteBashRule && item !== taskStartRule) {
      combined.push(item);
      continue;
    }
    if (inserted) continue;
    combined.push(combinedRule);
    inserted = true;
  }
  return combined;
}

function formatTaggedBulletSection(tag: string, items: string[]): string {
  if (items.length === 0) return "";
  return [`<${tag}>`, formatBulletList(items), `</${tag}>`].join("\n");
}

function formatBulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function buildPlanModeInstructions(planDir: string): string {
  const planDirAttribute = escapeXml(planDir.replace(/\\/g, "/"));
  return promptText`
    <plan_mode active="true" plan_dir="${planDirAttribute}">
    Research and write a reviewed plan before any workspace edits.

    Hard rules:
    - Use read-only tools and safe commands for research.
    - Write/edit only Markdown plan files under the plan_dir.
    - Do not change workspace code, install dependencies, deploy, or start long-running processes.
    - Present the final plan with plan_mode_present; implement only after acceptance.

    Workflow:
    1. Inspect the code and relevant options.
    2. Ask the user only for user-dependent decisions.
    3. Write a self-contained, file-specific plan under plan_dir.
    4. Resolve open decisions, then present it.

    Plan quality:
    - Include affected files/symbols, ordered steps, validation, risks, and migrations if relevant.
    - Do not leave unresolved questions or decision callouts in the final plan.
    </plan_mode>
  `;
}

function formatEnvironment(options: { date: string; cwd: string }): string {
  return promptText`
    <environment>
    Current date: ${options.date}
    Current working directory: ${options.cwd}
    </environment>
  `;
}

function formatProjectInstructions(
  contextFiles: Array<{ path: string; content: string }>,
): string {
  return contextFiles
    .map((file) =>
      [
        `<project_instructions path="${escapeXml(file.path)}">`,
        file.content.trimEnd(),
        "</project_instructions>",
      ].join("\n"),
    )
    .join("\n\n");
}

function currentDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
