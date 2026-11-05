const BUILTIN_SUGGESTION_ICON_KEYS = {
  "commit-changes": "commit",
  "commit-on-feature-branch": "branch",
  "create-pull-request": "pull-request",
  "update-pull-request": "pull-request-update",
  "fix-failing-checks": "failed",
  "push-commits": "push",
  "pull-upstream": "pull",
  "review-changes": "review",
  "cleanup-merged-branch": "cleanup",
  "continue-after-failure": "retry",
} as const;

export type SuggestionIconKey =
  | (typeof BUILTIN_SUGGESTION_ICON_KEYS)[keyof typeof BUILTIN_SUGGESTION_ICON_KEYS]
  | "default";

/** Icon key for a suggestion; only built-in names have dedicated icons. */
export function suggestionIconKey(suggestion: {
  name: string;
  source: { kind: string };
}): SuggestionIconKey {
  const icons: Record<string, SuggestionIconKey> = BUILTIN_SUGGESTION_ICON_KEYS;
  if (
    suggestion.source.kind !== "builtin" ||
    !Object.hasOwn(icons, suggestion.name)
  )
    return "default";
  return icons[suggestion.name]!;
}
