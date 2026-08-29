<script lang="ts">
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import type { ComposerSuggestion } from "./composer-suggestion";

type Props = {
  suggestions?: ComposerSuggestion[];
  disabled?: boolean;
  onSend?: (suggestion: ComposerSuggestion) => void;
  onDraft?: (suggestion: ComposerSuggestion) => void;
};

let { suggestions = [], disabled = false, onSend, onDraft }: Props = $props();
</script>

{#if suggestions.length > 0}
  <div
    class="flex flex-wrap gap-1 px-0.5"
    role="group"
    aria-label="Suggested prompt actions"
  >
    {#each suggestions as suggestion (suggestion.id)}
      {@const Icon = suggestion.icon ?? Lightbulb}
      <button
        type="button"
        class="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-55"
        {disabled}
        title={`Click to send. Right-click to insert into composer.\n\n${suggestion.prompt}`}
        aria-label={`${suggestion.label}. Click to send. Right-click to insert into composer.`}
        onclick={() => onSend?.(suggestion)}
        oncontextmenu={(event) => {
          event.preventDefault();
          onDraft?.(suggestion);
        }}
      >
        <Icon
          class="size-3.5 text-primary"
          strokeWidth={2.2}
          aria-hidden="true"
        />
        <span>{suggestion.label}</span>
      </button>
    {/each}
  </div>
{/if}
