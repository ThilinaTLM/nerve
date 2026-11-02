import {
  PROMPT_SUGGESTION_PREVIEW_MAX_LENGTH,
  type PromptSuggestionStatus,
  type PromptSuggestionWhen,
} from "@nervekit/contracts/prompt-suggestions";
import type { PromptSuggestionDefinition } from "./prompt-suggestion-types.js";

export function truncatePreview(text: string): string {
  return text.length > PROMPT_SUGGESTION_PREVIEW_MAX_LENGTH
    ? `${text.slice(0, PROMPT_SUGGESTION_PREVIEW_MAX_LENGTH)}…`
    : text;
}

/** Readable "Appears when…" text for a declarative `when` plus optional JS. */
export function summarizeWhen(
  when: PromptSuggestionWhen | undefined,
  hasJs: boolean,
): string {
  const parts: string[] = [];
  if (when?.hasRepos !== undefined)
    parts.push(
      when.hasRepos
        ? "the project has Git repositories"
        : "there are no Git repositories",
    );
  if (when?.gitDirty !== undefined)
    parts.push(
      when.gitDirty
        ? "a repository has uncommitted changes"
        : "no repository has uncommitted changes",
    );
  if (when?.gitAhead !== undefined)
    parts.push(
      when.gitAhead
        ? "a repository has commits to push"
        : "no repository has commits to push",
    );
  if (when?.gitBehind !== undefined)
    parts.push(
      when.gitBehind
        ? "a repository is behind its upstream"
        : "no repository is behind its upstream",
    );
  if (when?.onBaseBranch !== undefined)
    parts.push(
      when.onBaseBranch
        ? "a repository is on its base branch"
        : "no repository is on its base branch",
    );
  if (when?.hasPullRequest !== undefined)
    parts.push(
      when.hasPullRequest
        ? "the current branch has an open pull request"
        : "the current branch has no open pull request",
    );
  if (when?.githubAuthenticated !== undefined)
    parts.push(
      when.githubAuthenticated
        ? "GitHub CLI is authenticated"
        : "GitHub CLI is not authenticated",
    );
  if (when?.permissionRuleSets?.length)
    parts.push(
      `the conversation uses the ${when.permissionRuleSets.join(" or ")} permission rule set`,
    );
  if (hasJs) parts.push("a custom JavaScript check passes");
  return parts.length === 0
    ? "Always appears."
    : `Appears when ${parts.join(", and ")}.`;
}

export function suggestionStatusDetails(
  definition: PromptSuggestionDefinition,
): Pick<PromptSuggestionStatus, "conditionSummary" | "promptPreview"> {
  return {
    conditionSummary:
      definition.conditionSummary ??
      summarizeWhen(definition.when, Boolean(definition.enableJs)),
    promptPreview: truncatePreview(
      definition.promptPreview ?? definition.prompt,
    ),
  };
}
