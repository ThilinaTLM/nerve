<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
import Play from "@lucide/svelte/icons/play";
import type { NotificationTone } from "$lib/api";
import {
  notificationToneOptions,
  previewNotificationSound,
} from "$lib/features/notifications/state/notification-sounds";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Popover from "@nervekit/ui-kit/components/ui/popover";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  value,
  ariaLabel,
  disabled = false,
  onValueChange,
  class: className,
}: {
  value: NotificationTone;
  ariaLabel: string;
  disabled?: boolean;
  onValueChange?: (value: NotificationTone) => void;
  class?: string;
} = $props();

let open = $state(false);

const selectedOption = $derived(
  notificationToneOptions.find((option) => option.value === value) ??
    notificationToneOptions[0],
);

function selectTone(tone: NotificationTone): void {
  onValueChange?.(tone);
  open = false;
}

function previewTone(tone: NotificationTone): void {
  if (tone !== "none") previewNotificationSound(tone);
}
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="outline"
        size="sm"
        {disabled}
        class={cn("w-full min-w-0 justify-between", className)}
        {ariaLabel}
      >
        <span class="truncate">{selectedOption?.label ?? "Select sound"}</span>
        <ChevronsUpDown
          class="size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    align="end"
    class="max-h-80 w-(--bits-popover-anchor-width) min-w-72 gap-0 overflow-y-auto p-1"
  >
    <div class="sr-only">Choose and preview a notification sound</div>
    <div role="radiogroup" aria-label={ariaLabel}>
      {#each notificationToneOptions as option (option.value)}
        <div class="flex min-w-0 items-center gap-1 rounded-sm">
          <Button
            variant="ghost"
            size="sm"
            class="h-auto min-w-0 flex-1 justify-between px-2 py-1.5 text-left"
            active={option.value === value}
            role="radio"
            aria-checked={option.value === value}
            onclick={() => selectTone(option.value)}
          >
            <span class="flex min-w-0 flex-col items-start">
              <span class="truncate">{option.label}</span>
              <span class="truncate text-xs font-normal text-muted-foreground">
                {option.detail}
              </span>
            </span>
            {#if option.value === value}
              <Check class="size-4" aria-hidden="true" />
            {/if}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            ariaLabel={`Preview ${option.label}`}
            title={`Preview ${option.label}`}
            disabled={option.value === "none"}
            onclick={() => previewTone(option.value)}
          >
            <Play class="size-4" aria-hidden="true" />
          </Button>
        </div>
      {/each}
    </div>
  </Popover.Content>
</Popover.Root>
