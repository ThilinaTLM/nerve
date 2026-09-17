import {
  FILE_COMPLETION_RESULT_LIMIT,
  type CompletionItem,
} from "@nervekit/contracts/completions";
import type { GithubPr } from "@nervekit/contracts/git";
import type { TaskRecord } from "@nervekit/contracts/tasks";

const activeTaskStatuses = new Set([
  "starting",
  "running",
  "ready",
  "stopping",
]);

function includesQuery(
  values: Array<string | null | undefined>,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  return (
    !needle || values.some((value) => value?.toLowerCase().includes(needle))
  );
}

export function taskReferenceCompletions(
  tasks: readonly TaskRecord[],
  query: string,
): CompletionItem[] {
  return [...tasks]
    .filter((task) =>
      includesQuery(
        [task.id, task.displayName, task.name, task.command, task.status],
        query,
      ),
    )
    .sort((left, right) => {
      const activeDelta =
        Number(activeTaskStatuses.has(right.status)) -
        Number(activeTaskStatuses.has(left.status));
      return activeDelta || right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, FILE_COMPLETION_RESULT_LIMIT)
    .map((task) => {
      const name = task.displayName ?? task.name ?? task.command ?? task.id;
      return {
        label: task.id,
        displayLabel: name,
        detail: `${task.id} · ${task.status}`,
        info: task.command,
        kind: "task" as const,
      };
    });
}

export function pullRequestReferenceCompletions(
  prs: readonly GithubPr[],
  repo: string,
  query: string,
): CompletionItem[] {
  return prs
    .filter((pr) =>
      includesQuery(
        [
          String(pr.number),
          pr.title,
          pr.author,
          pr.headRefName,
          pr.baseRefName,
          pr.state,
        ],
        query.replace(/^#/, ""),
      ),
    )
    .slice(0, FILE_COMPLETION_RESULT_LIMIT)
    .map((pr) => ({
      label: pr.url,
      displayLabel: `#${pr.number} ${pr.title}`,
      detail:
        repo === "."
          ? `${pr.state} · ${pr.url}`
          : `${repo} · ${pr.state} · ${pr.url}`,
      info: pr.url,
      kind: "pull_request" as const,
    }));
}
