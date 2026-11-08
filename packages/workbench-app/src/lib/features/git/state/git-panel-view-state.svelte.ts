import type { GitRepoSummary } from "@nervekit/contracts/git";
import { SvelteSet } from "svelte/reactivity";
import {
  buildRepoGroups,
  worktreeGroupOf,
  type GitPanelFilter,
} from "../views/git-repo-tree";
import {
  defaultGitPanelLayout,
  loadGitPanelLayout,
  loadGitProjectPreferences,
  persistGitPanelLayout,
  persistGitProjectPreferences,
  pruneGitProjectPreferences,
  type GitPanelLayoutPreferences,
  type GitSectionLayout,
} from "./git-panel-preferences";

/** Remembered list choices of one project plus the in-session search text. */
export class GitProjectView {
  filter = $state<GitPanelFilter>("all");
  /** Search text is kept while switching tabs but not across reloads. */
  search = $state("");
  selected = $state<string | null>(null);
  readonly expanded = new SvelteSet<string>();
  /** False until the user or the first snapshot decided what is expanded. */
  private expansionKnown = false;

  private readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
    const stored = loadGitProjectPreferences(projectId);
    this.filter = stored.filter;
    this.selected = stored.selected;
    if (stored.expanded) {
      this.expansionKnown = true;
      stored.expanded.forEach((key) => this.expanded.add(key));
    }
  }

  private save(): void {
    persistGitProjectPreferences(this.projectId, {
      filter: this.filter,
      expanded: this.expansionKnown ? [...this.expanded] : null,
      selected: this.selected,
    });
  }

  setFilter(filter: GitPanelFilter): void {
    this.filter = filter;
    this.save();
  }

  select(worktree: string): void {
    if (this.selected === worktree) return;
    this.selected = worktree;
    this.save();
  }

  setExpanded(group: string, expanded: boolean): void {
    this.expansionKnown = true;
    if (expanded) this.expanded.add(group);
    else this.expanded.delete(group);
    this.save();
  }

  /**
   * A discovery snapshot arrived: forget groups and worktrees that are gone;
   * on the first load expand only the repository of the selected branch.
   */
  reconcile(
    repositories: readonly GitRepoSummary[],
    selected: string | undefined,
  ): void {
    const groups = new SvelteSet(repositories.map(worktreeGroupOf));
    const worktrees = new SvelteSet(
      repositories.map((repo) => repo.relativePath),
    );
    const pruned = pruneGitProjectPreferences(
      {
        filter: this.filter,
        expanded: this.expansionKnown ? [...this.expanded] : null,
        selected: this.selected,
      },
      { groups, worktrees },
    );
    if (pruned.expanded)
      for (const key of [...this.expanded])
        if (!pruned.expanded.includes(key)) this.expanded.delete(key);
    this.selected = pruned.selected;
    if (!this.expansionKnown && repositories.length > 0) {
      const target = repositories.find(
        (repo) => repo.relativePath === selected,
      );
      const key = target
        ? worktreeGroupOf(target)
        : buildRepoGroups(repositories)[0]?.key;
      if (key) this.expanded.add(key);
      this.expansionKnown = true;
    }
    this.save();
  }
}

// A plain cache: it is created lazily from inside deriveds, so it must not be reactive.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const views = new Map<string, GitProjectView>();

export function gitProjectView(projectId: string): GitProjectView {
  let view = views.get(projectId);
  if (!view) {
    view = new GitProjectView(projectId);
    views.set(projectId, view);
  }
  return view;
}

/** Selected-branch and Changes sections: the same in every project. */
class GitPanelLayout {
  branch = $state<GitSectionLayout>(defaultGitPanelLayout().branch);
  changes = $state<GitSectionLayout>(defaultGitPanelLayout().changes);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const stored = loadGitPanelLayout();
    this.branch = stored.branch;
    this.changes = stored.changes;
  }

  snapshot(): GitPanelLayoutPreferences {
    return {
      branch: { ...this.branch },
      changes: { ...this.changes },
    };
  }

  /** Writes are debounced so dragging a divider does not hit storage per frame. */
  save(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      persistGitPanelLayout(this.snapshot());
    }, 300);
  }
}

let layout: GitPanelLayout | undefined;
export function gitPanelLayout(): GitPanelLayout {
  layout ??= new GitPanelLayout();
  return layout;
}
