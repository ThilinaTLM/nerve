<script lang="ts">
import FileText from "@lucide/svelte/icons/file-text";
import Gauge from "@lucide/svelte/icons/gauge";
import type { ConversationHarnessSettingsResult } from "@nervekit/contracts/core";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  compactionDetail,
  compactionSourceLabel,
  compactionSummary,
  formatBytes,
  instructionsBytes,
} from "./conversation-settings";

/**
 * Conversation-level icon actions in the context popover header: compaction
 * and custom instructions. Each shows its current value in a tooltip and opens
 * an edit dialog owned by the host, so closing the popover never loses a
 * draft. Sub-agents also show their profile.
 */
let {
  harness,
  instructions,
  profile,
  disabled = false,
  onEditCompaction,
  onEditInstructions,
}: {
  harness?: ConversationHarnessSettingsResult;
  instructions: string | null | undefined;
  /** Profile badge text; sub-agents only. */
  profile?: string;
  disabled?: boolean;
  onEditCompaction: () => void;
  onEditInstructions: () => void;
} = $props();

const compaction = $derived(harness?.compaction);
const overridden = $derived(compaction?.source === "conversation");
const trimmedInstructions = $derived(instructions?.trim() ?? "");
</script>

{#snippet marker()}
  <span
    class="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
    aria-hidden="true"
  ></span>
{/snippet}

{#if profile}
  <Badge variant="outline" class="mr-1">{profile}</Badge>
{/if}

<Tooltip.Provider delayDuration={200}>
  <Tooltip.Root ignoreNonKeyboardFocus>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span {...props} class="inline-flex">
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={disabled || !compaction}
            class="relative text-muted-foreground hover:text-foreground"
            ariaLabel={compaction
              ? `Compaction: ${compactionSummary(compaction.effective)}`
              : "Compaction"}
            onclick={onEditCompaction}
          >
            <Gauge class="size-3.5" aria-hidden="true" />
            {#if overridden}{@render marker()}{/if}
          </Button>
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content
      side="top"
      class="max-w-sm flex-col items-stretch gap-1 py-2"
    >
      <div class="flex items-baseline justify-between gap-4">
        <span class="font-medium">Compaction</span>
        {#if compaction}
          <span class="text-muted-foreground"
            >{compactionSourceLabel(compaction.source)}</span
          >
        {/if}
      </div>
      {#if compaction}
        <p class="font-medium">{compactionSummary(compaction.effective)}</p>
        <p class="text-muted-foreground">
          {compactionDetail(compaction.effective)}
        </p>
      {:else}
        <p class="text-muted-foreground">Loading…</p>
      {/if}
      <p class="border-t pt-1 text-muted-foreground">Click to change</p>
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>

<Tooltip.Provider delayDuration={200}>
  <Tooltip.Root ignoreNonKeyboardFocus>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span {...props} class="inline-flex">
          <Button
            size="icon-xs"
            variant="ghost"
            {disabled}
            class="relative text-muted-foreground hover:text-foreground"
            ariaLabel={trimmedInstructions
              ? "Custom instructions"
              : "Custom instructions: none"}
            onclick={onEditInstructions}
          >
            <FileText class="size-3.5" aria-hidden="true" />
            {#if trimmedInstructions}{@render marker()}{/if}
          </Button>
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content
      side="top"
      class="max-w-sm flex-col items-stretch gap-1 py-2"
    >
      <div class="flex items-baseline justify-between gap-4">
        <span class="font-medium">Custom instructions</span>
        {#if trimmedInstructions}
          <span class="text-muted-foreground tabular-nums"
            >{formatBytes(instructionsBytes(trimmedInstructions))}</span
          >
        {/if}
      </div>
      {#if trimmedInstructions}
        <p class="line-clamp-12 break-words whitespace-pre-wrap">
          {trimmedInstructions}
        </p>
      {:else}
        <p class="text-muted-foreground">None</p>
      {/if}
      <p class="border-t pt-1 text-muted-foreground">Click to edit</p>
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
