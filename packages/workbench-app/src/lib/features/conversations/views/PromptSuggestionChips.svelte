<script lang="ts">
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import { Button } from "@nervekit/ui-kit/components/ui/button";
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="text-muted-foreground hover:border-primary/40 hover:text-foreground"
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
      </Button>
    {/each}
  </div>
{/if}
