<script lang="ts">
import Star from "@lucide/svelte/icons/star";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import * as Popover from "@nervekit/ui-kit/components/ui/popover";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
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

function choose(level: ThinkingLevel): void {
  onSelect(level);
  open = false;
}
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <IconAction
        {...props}
        icon={Star}
        active={isDefault}
        {disabled}
        label={isDefault
          ? "Default model for new agents"
          : `Make ${label} the default model`}
      />
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="end" class="w-auto max-w-72 gap-1.5 p-2">
    <p class="text-xs text-muted-foreground">
      Thinking level new agents start on
    </p>
    <ToggleGroup.Root
      type="single"
      size="xs"
      spacing={1}
      variant="chip"
      value={activeLevel}
      aria-label={`Default thinking level for ${label}`}
      class="flex-wrap justify-start"
      onValueChange={(value) => {
        if (value) choose(value as ThinkingLevel);
      }}
    >
      {#each levels as level (level)}
        <ToggleGroup.Item
          value={level}
          class="flex-none text-xs capitalize data-[state=on]:text-primary"
          >{level}</ToggleGroup.Item
        >
      {/each}
    </ToggleGroup.Root>
  </Popover.Content>
</Popover.Root>
