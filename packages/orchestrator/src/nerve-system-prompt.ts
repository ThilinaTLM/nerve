import { formatSkillsForSystemPrompt, type Skill } from "@nerve/agent";

export interface BuildNerveSystemPromptOptions {
  customPrompt?: string;
  selectedTools?: string[];
  promptGuidelines?: string[];
  appendSystemPrompt?: string;
  cwd: string;
  mode?: "planning" | "coding";
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

  const footer = `Current date: ${date}\nCurrent working directory: ${cwd}`;

  return [
    basePrompt,
    options.appendSystemPrompt,
    formatProjectInstructions(options.contextFiles ?? []),
    skillsBlock,
    footer,
  ]
    .filter((section): section is string => Boolean(section?.trim()))
    .join("\n\n");
}

function defaultPrompt(options: {
  selectedTools: string[];
  promptGuidelines: string[];
  mode?: "planning" | "coding";
}): string {
  const guidelines: string[] = [];
  const seen = new Set<string>();
  const addGuideline = (value: string) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    guidelines.push(normalized);
  };

  const hasBash = options.selectedTools.includes("bash");
  const hasGrep = options.selectedTools.includes("grep");
  const hasFind = options.selectedTools.includes("find");
  const hasLs = options.selectedTools.includes("ls");
  if (hasBash && !hasGrep && !hasFind && !hasLs) {
    addGuideline("Use bash for file operations like ls, rg, find");
  }
  for (const guideline of options.promptGuidelines) addGuideline(guideline);
  if (options.mode === "planning") {
    addGuideline(
      "Planning mode: inspect and prepare only; do not modify workspace files or run mutating commands.",
    );
    addGuideline(
      "Write plans with plan_write using a descriptive lowercase slug, then call plan_mode_present for user review.",
    );
    addGuideline("Do not implement workspace changes until the plan is accepted.");
  } else {
    addGuideline(
      "If the user asks for a plan or the task needs research before edits, call plan_mode_enter first.",
    );
  }
  addGuideline("Be concise in your responses");
  addGuideline("Show file paths clearly when working with files");

  return `You are an expert coding assistant operating inside Nerve, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

${formatToolSummary(options.selectedTools)}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines.map((guideline) => `- ${guideline}`).join("\n")}`;
}

function formatToolSummary(selectedTools: string[]): string {
  const tools = selectedTools.length > 0 ? selectedTools.join(", ") : "none";
  return `Tools available in this session include: ${tools}. Use the API-provided tool schemas as the source of truth for arguments and capabilities.`;
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
