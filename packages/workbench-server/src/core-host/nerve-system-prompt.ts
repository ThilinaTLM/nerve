import {
  formatSkillsForSystemPrompt,
  type Skill,
} from "@nervekit/harness/resources";

export interface BuildNerveSystemPromptOptions {
  customPrompt?: string;
  /** Conversation-local full base override; captured instructions still contribute. */
  systemPrompt?: string | null;
  selectedTools?: string[];
  appendSystemPrompt?: string;
  cwd: string;
  contextFiles?: Array<{ path: string; content: string }>;
  skills?: Skill[];
  agentProfiles?: Array<{
    name: string;
    description: string;
    permission: string;
  }>;
  /** Persona and working rules for this conversation only. */
  instructions?: string | null;
}

export function buildNerveSystemPrompt(
  options: BuildNerveSystemPromptOptions,
): string {
  if (options.systemPrompt != null)
    return [options.systemPrompt, options.instructions]
      .filter(Boolean)
      .join("\n\n");
  const cwd = options.cwd.replace(/\\/g, "/");
  const date = currentDate();
  const tools = options.selectedTools ?? ["read", "bash", "edit", "write"];
  const hasRead = tools.includes("read");

  const basePrompt = options.customPrompt?.trim()
    ? options.customPrompt
    : defaultPrompt(tools.includes("ask_user"));

  const skillsBlock =
    hasRead && (options.skills?.length ?? 0) > 0
      ? formatSkillsForSystemPrompt(options.skills ?? [])
      : "";

  const environmentBlock = formatEnvironment({ date, cwd });

  return [
    basePrompt,
    options.appendSystemPrompt,
    options.instructions?.trim()
      ? ["<instructions>", options.instructions.trim(), "</instructions>"].join(
          "\n",
        )
      : "",
    formatProjectInstructions(options.contextFiles ?? []),
    skillsBlock,
    tools.includes("subagent_prompt") && options.agentProfiles?.length
      ? formatTaggedBulletSection(
          "available_agent_profiles",
          options.agentProfiles.map(
            (profile) =>
              `${profile.name}: ${profile.description} (permission: ${profile.permission})`,
          ),
        )
      : "",
    environmentBlock,
  ]
    .filter((section): section is string => Boolean(section?.trim()))
    .join("\n\n");
}

function defaultPrompt(hasAskUser: boolean): string {
  return [
    "You are Nerve's coding agent, working in the user's project. Keep responses concise.",
    formatTaggedBulletSection("guidelines", [
      "Continue until the task is complete or blocked by a user decision.",
      "While async work runs, do independent work or end your turn with a brief status. Completion notifications resume you; never sleep or poll just to wait.",
      "Responses render as Markdown with Mermaid; use diagrams for complex relationships or flows, otherwise prose.",
      ...(hasAskUser
        ? ["Ask the user questions with `ask_user`, not in your reply."]
        : []),
    ]),
  ].join("\n\n");
}

function formatTaggedBulletSection(tag: string, items: string[]): string {
  if (items.length === 0) return "";
  return [`<${tag}>`, formatBulletList(items), `</${tag}>`].join("\n");
}

function formatBulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
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
