import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import CloudDownload from "@lucide/svelte/icons/cloud-download";
import CloudUpload from "@lucide/svelte/icons/cloud-upload";
import GitMerge from "@lucide/svelte/icons/git-merge";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import GitPullRequestDraft from "@lucide/svelte/icons/git-pull-request-draft";
import type { Component } from "svelte";
import type { GithubPr } from "@nervekit/contracts/git";
import { isMergedPr, type SyncState } from "./git-repo-tree";

/** One glyph of a branch row's right-packed status cluster. */
export interface StatusGlyph {
  readonly icon?: Component<{ class?: string }>;
  readonly spinner?: boolean;
  readonly tone: string;
  /** Accessible label, also the tooltip. */
  readonly label: string;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

export function syncGlyph(
  state: SyncState,
  detail: { failure?: string; operation?: string } = {},
): StatusGlyph | undefined {
  switch (state.kind) {
    case "running":
      return {
        spinner: true,
        tone: "text-muted-foreground",
        label: `${detail.operation ?? "Operation"} running. Click to stop.`,
      };
    case "failed":
      return {
        icon: CircleAlert,
        tone: "text-destructive",
        label: `${detail.operation ?? "Operation"} failed${detail.failure ? `: ${detail.failure}` : ""}. Click to retry.`,
      };
    case "diverged":
      return {
        icon: ArrowDownUp,
        tone: "text-warning",
        label: `${plural(state.behind, "commit")} to pull, ${plural(state.ahead, "commit")} to push. Click to sync.`,
      };
    case "behind":
      return {
        icon: ArrowDown,
        tone: "text-warning",
        label: `${plural(state.behind, "commit")} to pull. Click to pull.`,
      };
    case "unpublished":
      return {
        icon: CloudUpload,
        tone: "text-muted-foreground",
        label: `Not published${state.unpublished ? `: ${plural(state.unpublished, "commit")}` : ""}. Click to publish.`,
      };
    case "ahead":
      return {
        icon: ArrowUp,
        tone: "text-muted-foreground",
        label: `${plural(state.ahead, "commit")} to push. Click to push.`,
      };
    default:
      return undefined;
  }
}

/**
 * Nothing urgent to show: a quiet remote action keeps the sync slot useful.
 * A worktree syncs; a collapsed repository with several worktrees fetches.
 */
export function idleRemoteGlyph(action: "sync" | "fetch"): StatusGlyph {
  return action === "sync"
    ? {
        icon: ArrowDownUp,
        tone: "text-muted-foreground/70 hover:text-foreground",
        label: "Up to date. Click to sync.",
      }
    : {
        icon: CloudDownload,
        tone: "text-muted-foreground/70 hover:text-foreground",
        label: "Up to date. Click to fetch.",
      };
}

/** A worktree can sync when it tracks an upstream branch. */
export const canSync = (repo: {
  hasRemote: boolean;
  hasUpstream: boolean;
  detached: boolean;
}): boolean => repo.hasRemote && repo.hasUpstream && !repo.detached;

export function prGlyph(pr: GithubPr | undefined): StatusGlyph | undefined {
  if (!pr) return undefined;
  if (isMergedPr(pr))
    return { icon: GitMerge, tone: "text-info", label: `#${pr.number} merged` };
  const { checks } = pr;
  const tone =
    checks.status === "failing"
      ? "text-destructive"
      : checks.status === "pending"
        ? "text-warning"
        : checks.status === "passing"
          ? "text-success"
          : "text-muted-foreground";
  const checksLabel =
    checks.status === "none"
      ? "no checks"
      : `checks ${checks.status}, ${checks.passed}/${checks.total}`;
  return {
    icon: pr.isDraft ? GitPullRequestDraft : GitPullRequest,
    tone,
    label: `#${pr.number}${pr.isDraft ? " draft" : ""}: ${checksLabel}`,
  };
}
