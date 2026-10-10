import {
  FILE_COMPLETION_RESULT_LIMIT,
  type CompletionItem,
} from "@nervekit/contracts/completions";
import type { GithubPr } from "@nervekit/contracts/git";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

function includesQuery(
  values: Array<string | null | undefined>,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  return (
    !needle || values.some((value) => value?.toLowerCase().includes(needle))
  );
}

export async function fileCompletions(
  projectId: string | undefined,
  query: string,
): Promise<CompletionItem[]> {
  if (!projectId) return [];
  return (
    await requestWorkbench("completion.files.list", {
      projectId,
      q: query,
      limit: FILE_COMPLETION_RESULT_LIMIT,
    })
  ).items;
}

function taskCompletions(
  tasks: readonly TaskRecord[],
  query: string,
): CompletionItem[] {
  const active = new Set(["starting", "running", "ready", "stopping"]);
  return [...tasks]
    .filter((task) =>
      includesQuery(
        [task.id, task.displayName, task.name, task.command, task.status],
        query,
      ),
    )
    .sort(
      (a, b) =>
        Number(active.has(b.status)) - Number(active.has(a.status)) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, FILE_COMPLETION_RESULT_LIMIT)
    .map((task) => ({
      label: task.id,
      displayLabel: task.displayName ?? task.name ?? task.command,
      detail: `${task.id} · ${task.status}`,
      info: task.command,
      kind: "task",
    }));
}

function pullRequestCompletions(
  prs: readonly GithubPr[],
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
      detail: `${pr.state} · ${pr.url}`,
      info: pr.url,
      kind: "pull_request",
    }));
}

export async function referenceCompletions(
  projectId: string | undefined,
  kind: "task" | "pull_request",
  query: string,
): Promise<CompletionItem[]> {
  if (!projectId) return [];
  if (kind === "task") {
    const { tasks } = await requestWorkbench("launch.list", {});
    return taskCompletions(
      tasks.filter((task) => task.projectId === projectId),
      query,
    );
  }
  const { prs } = await requestWorkbench("github.pr.list", {
    projectId,
    repo: ".",
    filters: {
      author: "any",
      drafts: "include",
      title: "",
      labels: [],
      sort: "updated-desc",
    },
  });
  return pullRequestCompletions(prs, query);
}
