import {
  type AgentModelSelection,
  listAvailableModels,
  streamAgentPrompt,
} from "@nerve/agent";
import type {
  GitBranchSuggestionResponse,
  GitCommitMessageResponse,
  GitOverviewResponse,
} from "@nerve/shared";

const SUGGESTION_MAX_TOKENS = 512;

export interface UtilityLlmDeps {
  getApiKey: (provider: string) => Promise<string | undefined>;
}

/**
 * A reusable, single-shot, tool-less LLM helper — the minimal
 * "limited-capability agent". It has no tools, no file access, no persisted
 * conversation, and no approvals; it just turns a prompt into text. Used here
 * for branch-name / commit-message suggestions and reusable by future features.
 */
export class UtilityLlmService {
  constructor(private readonly deps: UtilityLlmDeps) {}

  /** Pick a usable model: caller preference, else first non-faux, else faux. */
  private pickModel(
    preferred?: AgentModelSelection,
  ): AgentModelSelection | undefined {
    if (preferred && preferred.provider !== "nerve-faux") return preferred;
    const models = listAvailableModels();
    const real = models.find((model) => model.provider !== "nerve-faux");
    if (real) return { provider: real.provider, modelId: real.modelId };
    return preferred;
  }

  async complete(options: {
    system: string;
    prompt: string;
    model?: AgentModelSelection;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const model = this.pickModel(options.model);
    const apiKey =
      model && model.provider !== "nerve-faux"
        ? await this.deps.getApiKey(model.provider)
        : undefined;
    const stream = streamAgentPrompt({
      systemPrompt: options.system,
      messages: [
        { role: "user", content: options.prompt, timestamp: Date.now() },
      ],
      model,
      apiKey,
      signal: options.signal,
    });
    return collectText(stream);
  }

  async suggestBranchName(options: {
    overview: GitOverviewResponse;
    diff: string;
    model?: AgentModelSelection;
    signal?: AbortSignal;
  }): Promise<GitBranchSuggestionResponse> {
    const { overview } = options;
    const text = await this.complete({
      system: [
        "You suggest git branch names from a set of changes.",
        "Reply with 1-3 candidate names, one per line, nothing else.",
        "Each name must be kebab-case, may use a type prefix (feat/, fix/, chore/, refactor/),",
        "contain no spaces, and be at most 60 characters.",
      ].join("\n"),
      prompt: buildChangePrompt(overview, options.diff),
      model: options.model,
      maxTokens: SUGGESTION_MAX_TOKENS,
      signal: options.signal,
    });

    const candidates = text
      .split("\n")
      .map((line) => slugifyBranch(line))
      .filter((line) => line.length > 0);
    const unique = [...new Set(candidates)];
    const suggestion = unique[0] ?? fallbackBranchName();
    return { suggestion, alternatives: unique.slice(1, 3) };
  }

  async suggestCommitMessage(options: {
    overview: GitOverviewResponse;
    diff: string;
    model?: AgentModelSelection;
    signal?: AbortSignal;
  }): Promise<GitCommitMessageResponse> {
    const { overview } = options;
    const text = await this.complete({
      system: [
        "You write concise git commit messages in conventional-commit style.",
        "First line: an imperative subject, at most 72 characters, no trailing period.",
        "Optionally add a blank line then a short body with '- ' bullet points for notable changes.",
        "Reply with only the commit message.",
      ].join("\n"),
      prompt: buildChangePrompt(overview, options.diff),
      model: options.model,
      maxTokens: SUGGESTION_MAX_TOKENS,
      signal: options.signal,
    });

    const lines = text.trim().split("\n");
    const subject = (lines[0] ?? "").trim().slice(0, 72) || "Update changes";
    const body = lines.slice(1).join("\n").trim();
    return { subject, body: body.length > 0 ? body : undefined };
  }
}

function buildChangePrompt(
  overview: GitOverviewResponse,
  diff: string,
): string {
  const fileList = overview.files
    .slice(0, 40)
    .map((file) => `${file.staged ? "staged" : "unstaged"} ${file.path}`)
    .join("\n");
  const commits = overview.recentCommits
    .slice(0, 5)
    .map((commit) => `- ${commit.subject}`)
    .join("\n");
  return [
    `Current branch: ${overview.repo.currentBranch ?? "(detached)"}`,
    `Base branch: ${overview.baseBranch}`,
    `Stats: +${overview.insertions} -${overview.deletions} across ${overview.files.length} file(s)`,
    "",
    "Changed files:",
    fileList || "(none)",
    "",
    "Recent commits for tone reference:",
    commits || "(none)",
    "",
    "Diff (may be truncated):",
    "```diff",
    diff || "(no diff available)",
    "```",
  ].join("\n");
}

const BRANCH_FALLBACK_PREFIX = "change/";

export function slugifyBranch(raw: string): string {
  return raw
    .trim()
    .replace(/^[-*\d.\s]+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "")
    .slice(0, 60)
    .replace(/[-/]+$/g, "");
}

function fallbackBranchName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${BRANCH_FALLBACK_PREFIX}${stamp}`.toLowerCase();
}

interface PartialLike {
  partial?: { content?: Array<{ type: string; text?: string }> };
}

async function collectText(stream: AsyncIterable<unknown>): Promise<string> {
  let latest: PartialLike["partial"];
  for await (const event of stream) {
    const partial = (event as PartialLike).partial;
    if (partial) latest = partial;
  }
  if (!latest?.content) return "";
  return latest.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}
