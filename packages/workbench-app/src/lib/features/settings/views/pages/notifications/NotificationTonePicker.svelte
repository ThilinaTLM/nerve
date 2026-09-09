<script lang="ts">
import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
import Play from "@lucide/svelte/icons/play";
import type { NotificationTone } from "$lib/api";
import {
  notificationToneOptions,
  previewNotificationSound,
} from "$lib/application/notifications/state/notification-sounds";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverRow,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { cn } from "@nervekit/ui-kit/utils";

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

<Popover
  bind:open
  size="md"
  align="end"
  {ariaLabel}
  triggerClass={cn("w-full min-w-0", className)}
>
  {#snippet trigger()}
    <span
      class={cn(
        "flex h-7 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input px-2 text-xs",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span class="truncate">{selectedOption?.label ?? "Select sound"}</span>
      <ChevronsUpDown class="size-4 text-muted-foreground" aria-hidden="true" />
    </span>
  {/snippet}

  <PopoverHeader title="Notification sound" />
  <PopoverBody>
    {#each notificationToneOptions as option (option.value)}
      <div class="flex min-w-0 items-center gap-1">
        <PopoverRow
          label={option.label}
          detail={option.detail}
          class="flex-1"
          selected={option.value === value}
          onclick={() => selectTone(option.value)}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          ariaLabel={`Preview ${option.label}`}
          title={`Preview ${option.label}`}
          disabled={option.value === "none"}
          onclick={() => previewTone(option.value)}
        >
          <Play class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    {/each}
  </PopoverBody>
</Popover>
