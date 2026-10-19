import type { CompletionSourceState } from "@nervekit/contracts/completions";

type FailureNotice = Pick<CompletionSourceState, "reason" | "action">;

/** Interpret owner error codes only; never show CLI output, URLs or credentials. */
export function completionRemoteFailure(
  code: string | undefined,
  cached: boolean,
): FailureNotice {
  let reason: string;
  let action: CompletionSourceState["action"];
  switch (code) {
    case "GH_CLI_UNAVAILABLE":
      reason = "GitHub CLI (gh) isn’t installed.";
      action = "open_pull_requests";
      break;
    case "GH_AUTH_REQUIRED":
      reason = "GitHub CLI isn’t signed in.";
      action = "open_pull_requests";
      break;
    case "GH_NO_REMOTE":
      reason = "This project has no Git remote.";
      break;
    case "GH_NO_GITHUB_REMOTE":
      reason = "This project has no GitHub remote.";
      break;
    case "GH_RATE_LIMITED":
      reason = "GitHub’s rate limit was reached. Try again later.";
      break;
    case "GH_API_UNAVAILABLE":
      reason = "GitHub is unreachable.";
      break;
    case "GH_FORBIDDEN":
      reason = "GitHub denied access. Check your token permissions.";
      break;
    case "GH_NOT_FOUND":
      reason = "The GitHub repository wasn’t found or isn’t accessible.";
      break;
    default:
      reason = "GitHub data couldn’t be loaded.";
  }
  if (cached) reason = `${reason.replace(/\.$/, "")} — showing cached results.`;
  return { reason, ...(action ? { action } : {}) };
}
