<script lang="ts">
import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
import Play from "@lucide/svelte/icons/play";
import type { NotificationTone } from "$lib/api";
import {
  notificationToneOptions,
  previewNotificationSound,
} from "$lib/features/notifications/state/notification-sounds";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Popover from "@nervekit/ui-kit/components/ui/popover";
import { SelectRow } from "@nervekit/ui-kit/components/ui/select-row";
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
    {#each notificationToneOptions as option (option.value)}
      <div class="flex min-w-0 items-center gap-1">
        <SelectRow
          label={option.label}
          detail={option.detail}
          class="flex-1"
          selected={option.value === value}
          onclick={() => selectTone(option.value)}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          ariaLabel={`Preview ${option.label}`}
          title={`Preview ${option.label}`}
          disabled={option.value === "none"}
          onclick={() => previewTone(option.value)}
        >
          <Play class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    {/each}
  </Popover.Content>
</Popover.Root>
