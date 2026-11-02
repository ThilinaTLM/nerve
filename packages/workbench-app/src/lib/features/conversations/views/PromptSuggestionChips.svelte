<script lang="ts">
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import type { ComposerSuggestion } from "./composer-suggestion";

type Props = {
  suggestions?: ComposerSuggestion[];
  /** The agent is running: clicking queues the prompt instead of sending it. */
  running?: boolean;
  onSend?: (suggestion: ComposerSuggestion) => void;
  onDraft?: (suggestion: ComposerSuggestion) => void;
};

let { suggestions = [], running = false, onSend, onDraft }: Props = $props();

const hint = $derived(
  running
    ? "Click to queue — sends when the agent finishes · Right-click to add to the composer"
    : "Click to send · Right-click to add to the composer",
);
</script>

{#if suggestions.length > 0}
  <Tooltip.Provider delayDuration={300} disableHoverableContent>
    <div
      class="flex flex-wrap gap-1"
      role="group"
      aria-label="Suggested prompt actions"
    >
      {#each suggestions as suggestion (suggestion.id)}
        {@const Icon = suggestion.icon ?? Lightbulb}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                type="button"
                variant="outline"
                class="text-muted-foreground hover:text-foreground"
                aria-label={`${suggestion.label}. ${hint}`}
                onclick={() => onSend?.(suggestion)}
                oncontextmenu={(event: MouseEvent) => {
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
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="top" sideOffset={4} class="max-w-sm">
            <div class="grid gap-1">
              <span class="font-medium">{suggestion.label}</span>
              {#if suggestion.description}
                <span class="line-clamp-3">{suggestion.description}</span>
              {:else}
                <!-- Custom suggestions without a description: show the prompt itself. -->
                <span class="line-clamp-3 whitespace-pre-wrap"
                  >{suggestion.prompt}</span
                >
              {/if}
              {#if suggestion.context}
                <span class="line-clamp-2 opacity-80">{suggestion.context}</span
                >
              {/if}
              <span class="opacity-80">{hint}</span>
            </div>
          </Tooltip.Content>
        </Tooltip.Root>
      {/each}
    </div>
  </Tooltip.Provider>
{/if}
