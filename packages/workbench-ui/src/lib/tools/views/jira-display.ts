import type { BadgeTone } from "@nervekit/ui-kit/components/ui/badge";

/**
 * Map a Jira status to a Badge tone. Authoritative `statusCategory` key wins
 * ("new" | "indeterminate" | "done"); otherwise fall back to a status-name
 * heuristic so historical/text-parsed rows still color sensibly.
 *
 * Pure (no Svelte imports) so it can be unit-tested under the node test runner.
 * Icon mappings live in `jira-icons.ts`.
 */
export function jiraStatusTone(status?: string, category?: string): BadgeTone {
  switch (category?.toLowerCase()) {
    case "new":
      return "neutral";
    case "indeterminate":
      return "running";
    case "done":
      return "good";
  }
  const name = status?.toLowerCase() ?? "";
  if (!name) return "neutral";
  if (/block/.test(name)) return "danger";
  if (/progress|review|doing|started/.test(name)) return "running";
  if (/done|closed|resolved|complete/.test(name)) return "good";
  return "neutral";
}

/**
 * Map a priority name to a Badge tone, or `undefined` for unknown/absent
 * priorities so callers can omit the chip entirely.
 */
export function jiraPriorityTone(priority?: string): BadgeTone | undefined {
  switch (priority?.toLowerCase()) {
    case "highest":
      return "danger";
    case "high":
      return "warn";
    case "medium":
    case "low":
    case "lowest":
      return "neutral";
    default:
      return undefined;
  }
}

/** Build a Jira browse link for an issue key, or `undefined` without a site URL. */
export function jiraIssueUrl(
  siteUrl: string | undefined,
  key: string,
): string | undefined {
  const base = siteUrl?.trim().replace(/\/+$/, "");
  if (!base) return undefined;
  return `${base}/browse/${encodeURIComponent(key)}`;
}

/** Up-to-two-character avatar initials from a user summary. */
export function jiraInitials(user: {
  displayName?: string;
  emailAddress?: string;
  accountId: string;
}): string {
  const source = user.displayName?.trim() || user.emailAddress?.trim() || "";
  if (source) {
    const words = source.split(/[\s@._-]+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
  }
  return user.accountId.slice(0, 2).toUpperCase();
}
