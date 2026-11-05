import type { Component } from "svelte";
import GitBranchPlus from "@lucide/svelte/icons/git-branch-plus";
import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import GitPullRequestArrow from "@lucide/svelte/icons/git-pull-request-arrow";
import CircleX from "@lucide/svelte/icons/circle-x";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ScanSearch from "@lucide/svelte/icons/scan-search";
import Trash2 from "@lucide/svelte/icons/trash-2";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Sparkles from "@lucide/svelte/icons/sparkles";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { gitContextFingerprint } from "$lib/features/git/state/git-context.svelte";
import {
  promptSuggestionsState,
  refreshPromptSuggestions,
} from "$lib/features/prompt-suggestions";
import type { ComposerSuggestion } from "$lib/features/conversations/views/composer-suggestion";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import {
  suggestionIconKey,
  type SuggestionIconKey,
} from "./prompt-suggestion-icons";

const ICONS: Record<SuggestionIconKey, Component> = {
  commit: GitCommitHorizontal,
  branch: GitBranchPlus,
  "pull-request": GitPullRequest,
  "pull-request-update": GitPullRequestArrow,
  failed: CircleX,
  push: ArrowUp,
  pull: ArrowDown,
  review: ScanSearch,
  cleanup: Trash2,
  retry: RotateCcw,
  default: Sparkles,
};

export type CenterPromptSuggestionsDependencies = {
  active: () => boolean;
  projectId: () => string | undefined;
  store: () => ConversationStore | undefined;
  conversationId: () => string | undefined;
};

/** Composer suggestion chips for one pane, refreshed as git/PR/conversation state changes. */
export class CenterPromptSuggestions {
  readonly #deps: CenterPromptSuggestionsDependencies;
  // Suggestions read the cached open PR, so a PR/check change can add or drop
  // chips without any git or conversation change. Debounced: sync bursts.
  #prChangeTick = $state(0);
  readonly #refreshKey = $derived.by(() => {
    const ctx = gitState.gitContext;
    return ctx ? `${ctx.projectId}:${gitContextFingerprint(ctx)}` : "none";
  });

  readonly suggestions = $derived.by<ComposerSuggestion[]>(() =>
    promptSuggestionsState.suggestions.map((suggestion) => ({
      id: `prompt:${suggestion.id}`,
      label: suggestion.label,
      prompt: suggestion.prompt,
      description: suggestion.description,
      context: suggestion.context,
      icon: ICONS[suggestionIconKey(suggestion)],
    })),
  );

  constructor(deps: CenterPromptSuggestionsDependencies) {
    this.#deps = deps;
    $effect(() => {
      if (!workbenchStartupState.progressiveActive || !this.#deps.active())
        return;
      const projectId = this.#deps.projectId();
      if (!projectId) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = onEvent("github.pr.changed", (event) => {
        if (event.data?.projectId !== projectId) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          this.#prChangeTick += 1;
        }, 1000);
      });
      return () => {
        stop();
        clearTimeout(timer);
      };
    });
    $effect(() => {
      const projectId = this.#deps.projectId();
      if (
        !workbenchStartupState.progressiveActive ||
        !this.#deps.active() ||
        !projectId
      )
        return;
      const store = this.#deps.store();
      void this.#refreshKey;
      void this.#prChangeTick;
      void store?.snapshot?.config;
      void store?.snapshot?.conversation.status;
      void store?.snapshot?.conversation.title;
      void refreshPromptSuggestions(projectId, {
        conversationId: this.#deps.conversationId(),
      });
    });
  }
}
