import { formatSkillsForSystemPrompt, type Skill } from "@nerve/agent";

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
  const footer = `Current date: ${date}\nCurrent working directory: ${cwd}`;

  return [
    basePrompt,
    options.appendSystemPrompt,
    planModeBlock,
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
  if (options.mode !== "planning") {
    addGuideline(
      "If the user asks for a plan or the task needs research before edits, call plan_mode_enter first.",
    );
  }
  addGuideline(
    "Continue working until the user's task is complete or a blocking user decision is required.",
  );
  addGuideline(
    "After each tool result, decide the next concrete action; do not stop with only 'I'll continue' prose.",
  );
  addGuideline(
    "If missing input prevents progress, ask a specific question with ask_user instead of silently ending.",
  );
  addGuideline(
    "Before the final response, summarize completed work and any remaining limitations.",
  );
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
  return `Tools available in this conversation include: ${tools}. Use the API-provided tool schemas as the source of truth for arguments and capabilities.`;
}

function buildPlanModeInstructions(planDir: string): string {
  return `[PLAN MODE ACTIVE]
You are in plan mode — a research and planning mode with guarded writes.

Restrictions:
- Use read-only research tools: read files, grep/find/ls, explore, web search/fetch, and planning-safe python when available.
- WRITE and EDIT only plan files inside ${planDir}/.
- NO code modifications outside the plans directory.
- Do not run mutating package scripts, long-running dev servers, deployments, or destructive commands.

## Your Role

You are a technical partner, not an order-taker. Research first, challenge weak assumptions, propose better alternatives when justified, and ask focused questions when user intent is unclear.

## Workflow

1. Understand the request and clarify user-dependent decisions.
2. Research the codebase and relevant options before proposing implementation details.
3. Discuss trade-offs and resolve meaningful decisions with the user with using ask_user tool.
4. Draft the plan as a markdown file under ${planDir}/ using write/edit.
5. Refine the plan until every open question and decision is resolved.
6. Present the finalized plan with plan_mode_present using the plan file path. Do not implement workspace changes until the plan is accepted.

## Plan Quality

- Name specific files, functions, types, and modules.
- Respect existing codebase patterns and conventions.
- Call out breaking changes, migrations, dependencies, ordering, and risks.
- Keep steps small and reviewable.
- The final plan must be self-contained and actionable with no unresolved question or decision callouts.`;
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
