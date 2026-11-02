<script lang="ts">
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ComposerSuggestion } from "./composer-suggestion";

/**
 * Phone counterpart of `PromptSuggestionChips`: one swipeable row instead of
 * wrapped lines, so suggestions never push the transcript up. Tap sends;
 * long-press (the touch context menu) puts the prompt in the composer.
 */
type Props = {
  suggestions?: ComposerSuggestion[];
  /** The agent is running: tapping queues the prompt. */
  running?: boolean;
  onSend?: (suggestion: ComposerSuggestion) => void;
  onDraft?: (suggestion: ComposerSuggestion) => void;
};

let { suggestions = [], running = false, onSend, onDraft }: Props = $props();
</script>

{#if suggestions.length > 0}
  <div
    class="suggestion-row flex gap-1.5 overflow-x-auto"
    role="group"
    aria-label="Suggested prompt actions"
  >
    {#each suggestions as suggestion (suggestion.id)}
      {@const Icon = suggestion.icon ?? Lightbulb}
      <Button
        type="button"
        variant="outline"
        class="flex-none text-muted-foreground"
        aria-label={`${suggestion.label}. ${running ? "Tap to queue — sends when the agent finishes." : "Tap to send."} Long-press to edit first.`}
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
      </Button>
    {/each}
  </div>
{/if}

<style>
/* Swiped, not scrolled with a pointer: the bar would only cover the chips. */
.suggestion-row {
  scrollbar-width: none;
  overscroll-behavior-x: contain;
}

.suggestion-row::-webkit-scrollbar {
  display: none;
}
</style>
