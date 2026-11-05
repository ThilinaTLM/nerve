import {
  FILESYSTEM_PROJECT_MONITOR_MAX_DIRECTORIES,
  type FilesystemProjectMonitorState,
} from "@nervekit/contracts/filesystem";
import type { GitProjectReadError } from "@nervekit/contracts/git";

/**
 * Keep monitor demand within the server cap. The project root is always kept,
 * then the most recently expanded directories (expansion order is insertion
 * order), so the folders the user just opened stay live.
 */
export function limitMonitoredDirectories(
  directories: readonly string[],
  max = FILESYSTEM_PROJECT_MONITOR_MAX_DIRECTORIES,
): { directories: string[]; requestedCount: number } {
  const unique = [...new Set(directories)];
  if (unique.length <= max)
    return { directories: unique, requestedCount: unique.length };
  const nested = unique.filter((path) => path !== "");
  return {
    directories: ["", ...nested.slice(nested.length - (max - 1))],
    requestedCount: unique.length,
  };
}

/** User-facing description of a monitor problem, or undefined when live updates are healthy. */
export function describeFileMonitorState(
  state: FilesystemProjectMonitorState,
  requestedCount: number,
  deliveredCount: number,
): string | undefined {
  if (!state.active)
    return "Live file updates are off. Use Refresh to see changes.";
  if (state.degraded)
    return "Live file updates are degraded. Some changes may need a manual refresh.";
  if (deliveredCount < requestedCount)
    return `Live updates cover ${deliveredCount} of ${requestedCount} open folders. Collapse folders or use Refresh to see other changes.`;
  return undefined;
}

export function describeFileMonitorFailure(error: unknown): string {
  return `Live file updates are unavailable (${messageOf(error)}). Use Refresh to see changes.`;
}

export function describeGitStatusErrors(
  errors: readonly GitProjectReadError[] | undefined,
): string | undefined {
  const [first, ...rest] = errors ?? [];
  if (!first) return undefined;
  const repo = first.repo === "." ? "the project repository" : first.repo;
  const more = rest.length > 0 ? ` (+${rest.length} more)` : "";
  return `Git status is incomplete for ${repo}: ${first.message}${more}`;
}

export function describeGitStatusFailure(error: unknown): string {
  return `Git status could not be refreshed (${messageOf(error)}). Showing the last known status.`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
