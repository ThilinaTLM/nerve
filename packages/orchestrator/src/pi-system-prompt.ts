import { formatSkillsForSystemPrompt, type Skill } from "@nerve/agent";

export interface BuildPiSystemPromptOptions {
  customPrompt?: string;
  selectedTools?: string[];
  toolSnippets?: Record<string, string>;
  promptGuidelines?: string[];
  appendSystemPrompt?: string;
  cwd: string;
  contextFiles?: Array<{ path: string; content: string }>;
  skills?: Skill[];
  nerveContext?: string;
}

export function buildPiSystemPrompt(
  options: BuildPiSystemPromptOptions,
): string {
  const cwd = options.cwd.replace(/\\/g, "/");
  const date = currentDate();
  const tools = options.selectedTools ?? ["read", "bash", "edit", "write"];
  const hasRead = tools.includes("read");
  const appendSection = options.appendSystemPrompt
    ? `\n\n${options.appendSystemPrompt}`
    : "";
  const nerveSection = options.nerveContext
    ? `\n\n${options.nerveContext}`
    : "";

  let prompt = options.customPrompt?.trim()
    ? options.customPrompt
    : defaultPrompt({
        selectedTools: tools,
        toolSnippets: options.toolSnippets ?? {},
        promptGuidelines: options.promptGuidelines ?? [],
      });

  prompt += appendSection;
  prompt += nerveSection;
  prompt += formatProjectContext(options.contextFiles ?? []);

  if (hasRead && (options.skills?.length ?? 0) > 0) {
    prompt += formatSkillsForSystemPrompt(options.skills ?? []);
  }

  prompt += `\nCurrent date: ${date}`;
  prompt += `\nCurrent working directory: ${cwd}`;
  return prompt;
}

function defaultPrompt(options: {
  selectedTools: string[];
  toolSnippets: Record<string, string>;
  promptGuidelines: string[];
}): string {
  const visibleTools = options.selectedTools.filter(
    (name) => options.toolSnippets[name],
  );
  const toolsList =
    visibleTools.length > 0
      ? visibleTools
          .map((name) => `- ${name}: ${options.toolSnippets[name]}`)
          .join("\n")
      : "(none)";

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
  addGuideline("Be concise in your responses");
  addGuideline("Show file paths clearly when working with files");

  return `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines.map((guideline) => `- ${guideline}`).join("\n")}`;
}

function formatProjectContext(
  contextFiles: Array<{ path: string; content: string }>,
): string {
  if (contextFiles.length === 0) return "";
  const lines = [
    "",
    "",
    "<project_context>",
    "",
    "Project-specific instructions and guidelines:",
    "",
  ];
  for (const file of contextFiles) {
    lines.push(
      `<project_instructions path="${escapeXml(file.path)}">`,
      file.content,
      "</project_instructions>",
      "",
    );
  }
  lines.push("</project_context>");
  return lines.join("\n");
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
