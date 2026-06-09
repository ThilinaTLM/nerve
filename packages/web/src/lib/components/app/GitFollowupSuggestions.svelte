<script lang="ts">
  import GitBranchPlus from "@lucide/svelte/icons/git-branch-plus";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
  import type { Component } from "svelte";
  import type { GitSuggestion } from "../../stores/workbench/git-context.svelte";

  type Props = {
    suggestions?: GitSuggestion[];
    disabled?: boolean;
    onSend?: (suggestion: GitSuggestion) => void;
    onDraft?: (suggestion: GitSuggestion) => void;
  };

  let { suggestions = [], disabled = false, onSend, onDraft }: Props = $props();

  const icons: Record<GitSuggestion["id"], Component> = {
    commit: GitCommitHorizontal,
    "commit-branch": GitBranchPlus,
    "open-pr": GitPullRequest,
  };
</script>

{#if suggestions.length > 0}
  <div class="git-suggestions" role="group" aria-label="Suggested git actions">
    {#each suggestions as suggestion (suggestion.id)}
      {@const Icon = icons[suggestion.id]}
      <button
        type="button"
        class="git-suggestion-chip"
        {disabled}
        title={`Click to send. Right-click to insert into composer.\n\n${suggestion.prompt}`}
        aria-label={`${suggestion.label}. Click to send. Right-click to insert into composer.`}
        onclick={() => onSend?.(suggestion)}
        oncontextmenu={(event) => {
          event.preventDefault();
          onDraft?.(suggestion);
        }}
      >
        <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
        <span>{suggestion.label}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .git-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    padding: 0 0.1rem;
  }

  .git-suggestion-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 1.7rem;
    padding: 0 0.7rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--card);
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }

  .git-suggestion-chip :global(svg) {
    color: var(--primary);
  }

  .git-suggestion-chip:hover:not(:disabled) {
    border-color: color-mix(in oklab, var(--primary) 40%, var(--border));
    background: var(--accent);
    color: var(--foreground);
  }

  .git-suggestion-chip:focus-visible {
    outline: 1px solid var(--ring);
    outline-offset: 1px;
  }

  .git-suggestion-chip:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
