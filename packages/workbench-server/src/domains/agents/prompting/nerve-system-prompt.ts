import { formatSkillsForSystemPrompt, type Skill } from "@nervekit/harness";
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
  for (const guideline of options.promptGuidelines) addToolRule(guideline);
  if (options.mode !== "planning" && activeTools.has("plan_mode_enter")) {
    addToolRule(
      "Enter plan mode before requested plans or design-heavy edits.",
    );
  }

  return promptText`
    You are Nerve's coding agent. Work safely in the current project and keep responses concise.

    ${formatTaggedBulletSection("tool_rules", toolRules)}

    <working_rules>
    - Continue until the task is complete or blocked by a user decision.
    - Use Mermaid diagrams when they clarify complex relationships or flows; otherwise prefer prose.
    - In the final response, summarize changes, validation, and remaining limits.
    </working_rules>
  `;
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
    Research and produce a user-reviewed implementation plan before workspace changes.

    - Keep research read-only; write only plan files under plan_dir.
    - Inspect the codebase, compare viable approaches, and ask the user only about requirement-dependent decisions.
    - Write a self-contained plan with affected files/symbols, ordered steps, validation, risks, and migrations when applicable.
    - Resolve every decision; leave no open questions or placeholders.
    - Present the plan with plan_mode_present and obtain approval before implementation.
    </plan_mode>
  `;
}

function formatEnvironment(options: { date: string; cwd: string }): string {
  return [
    "<environment>",
    `Current date: ${options.date}`,
    `Current working directory: ${options.cwd}`,
    "</environment>",
  ].join("\n");
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
