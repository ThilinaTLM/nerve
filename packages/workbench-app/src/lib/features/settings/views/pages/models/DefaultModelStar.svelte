<script lang="ts">
import Star from "@lucide/svelte/icons/star";
import Popover, {
  PopoverBody,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { cn } from "@nervekit/ui-kit/utils";
import { supportedThinkingLevelsForModel } from "$lib/application/preferences/agent-selection";
import type { AgentRecord, ModelInfo } from "$lib/api";

type ThinkingLevel = AgentRecord["thinkingLevel"];

type Props = {
  label: string;
  model?: ModelInfo;
  isDefault: boolean;
  disabled?: boolean;
  currentThinkingLevel: ThinkingLevel;
  onSelect: (thinkingLevel: ThinkingLevel) => void;
};

let {
  label,
  model,
  isDefault,
  disabled = false,
  currentThinkingLevel,
  onSelect,
}: Props = $props();

let open = $state(false);

const levels = $derived(supportedThinkingLevelsForModel(model));
/* The stored level may not exist on this model, so highlight nothing rather
 * than a level this model cannot run. */
const activeLevel = $derived(
  isDefault && levels.includes(currentThinkingLevel)
    ? currentThinkingLevel
    : undefined,
);
const triggerLabel = $derived(
  isDefault
    ? "Default model for new agents"
    : `Make ${label} the default model`,
);

function choose(level: ThinkingLevel): void {
  onSelect(level);
  open = false;
}
</script>

<Popover
  bind:open
  size="sm"
  align="end"
  ariaLabel={triggerLabel}
  triggerTitle={triggerLabel}
  triggerClass={cn(
    "size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
    isDefault && "text-primary",
    disabled && "pointer-events-none opacity-50",
  )}
>
  {#snippet trigger()}
    <Star
      class={cn("size-4", isDefault && "fill-primary")}
      aria-hidden="true"
    />
  {/snippet}

  <PopoverHeader title="Default thinking level" />
  <PopoverBody>
    <ToggleGroup.Root
      type="single"
      size="xs"
      spacing={1}
      variant="chip"
      value={activeLevel}
      aria-label={`Default thinking level for ${label}`}
      class="flex-wrap justify-start px-1.5"
      onValueChange={(value) => {
        if (value) choose(value as ThinkingLevel);
      }}
    >
      {#each levels as level (level)}
        <ToggleGroup.Item value={level} class="flex-none capitalize">
          {level}
        </ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
  </PopoverBody>
</Popover>
