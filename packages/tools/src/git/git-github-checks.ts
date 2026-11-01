import { summarizeChecks } from "./git-github-parsers.js";

export type RestCheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
  started_at?: string | null;
  completed_at?: string | null;
  app?: { name?: string; slug?: string };
  output?: { title?: string | null };
};
export type RestCommitStatus = {
  statuses: Array<{
    context: string;
    state: string;
    target_url?: string | null;
  }>;
};

export function summarizeRestChecks(
  runs: RestCheckRun[],
  status: RestCommitStatus,
) {
  return summarizeChecks([
    ...runs.map((run) => ({
      name: run.name,
      state:
        (run.status === "completed" ? run.conclusion : run.status) ?? "pending",
      link: run.html_url,
      // Every Actions run reports the same app; only other apps add signal.
      workflow:
        run.app?.slug === "github-actions" || run.app?.name === "GitHub Actions"
          ? undefined
          : run.app?.name,
      summary: [
        "failure",
        "timed_out",
        "cancelled",
        "action_required",
        "startup_failure",
      ].includes(run.conclusion ?? "")
        ? (run.output?.title ?? undefined)
        : undefined,
      startedAt: run.started_at ?? undefined,
      completedAt: run.completed_at ?? undefined,
    })),
    ...status.statuses.map((item) => ({
      name: item.context,
      state: item.state,
      link: item.target_url ?? undefined,
    })),
  ]);
}
