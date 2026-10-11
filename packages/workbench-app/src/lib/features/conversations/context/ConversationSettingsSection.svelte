<script lang="ts">
import {
  PopoverProperties,
  PopoverProperty,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ConversationHarnessSettingsResult } from "@nervekit/contracts/core";
import {
  compactionSourceLabel,
  compactionSummary,
  instructionsSummary,
} from "./conversation-settings";

/**
 * "This conversation" part of the context popover: compaction (inherited or
 * overridden), instructions, and for sub-agents the profile. Editing happens
 * in dialogs owned by the host, so closing the popover never loses a draft.
 */
let {
  harness,
  instructions,
  profile,
  disabled = false,
  onOverrideCompaction,
  onResetCompaction,
  onEditInstructions,
}: {
  harness?: ConversationHarnessSettingsResult;
  instructions: string | null | undefined;
  /** Profile badge text; sub-agents only. */
  profile?: string;
  disabled?: boolean;
  onOverrideCompaction: () => void;
  onResetCompaction: () => void;
  onEditInstructions: () => void;
} = $props();

const compaction = $derived(harness?.compaction);
const overridden = $derived(compaction?.source === "conversation");
</script>

<PopoverSection label="This conversation" separated>
  <PopoverProperties>
    <PopoverProperty label="Compaction">
      {#if compaction}
        <span class="flex min-w-0 items-center justify-end gap-1">
          <span
            class="min-w-0 truncate"
            title={`${compactionSummary(compaction.effective)} · ${compactionSourceLabel(compaction.source)}`}
          >
            {compactionSummary(compaction.effective)}
            <span class="text-muted-foreground"
              >· {compactionSourceLabel(compaction.source)}</span
            >
          </span>
          <Button
            size="xs"
            variant="ghost"
            {disabled}
            onclick={onOverrideCompaction}
          >
            {overridden ? "Edit" : "Override"}
          </Button>
          {#if overridden}
            <Button
              size="xs"
              variant="ghost"
              {disabled}
              onclick={onResetCompaction}
            >
              Reset
            </Button>
          {/if}
        </span>
      {:else}
        <span class="text-muted-foreground">Loading…</span>
      {/if}
    </PopoverProperty>
    <PopoverProperty label="Instructions">
      <span class="flex min-w-0 items-center justify-end gap-1">
        <span
          class="min-w-0 truncate text-muted-foreground"
          title={instructions ?? undefined}
        >
          {instructionsSummary(instructions)}
        </span>
        <Button
          size="xs"
          variant="ghost"
          {disabled}
          onclick={onEditInstructions}
        >
          Edit
        </Button>
      </span>
    </PopoverProperty>
    {#if profile}
      <PopoverProperty label="Profile">
        <Badge variant="outline">{profile}</Badge>
      </PopoverProperty>
    {/if}
  </PopoverProperties>
</PopoverSection>
