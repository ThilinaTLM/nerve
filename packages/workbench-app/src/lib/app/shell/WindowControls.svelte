<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import ChevronUp from "@lucide/svelte/icons/chevron-up";
import Copy from "@lucide/svelte/icons/copy";
import Diamond from "@lucide/svelte/icons/diamond";
import Minus from "@lucide/svelte/icons/minus";
import Square from "@lucide/svelte/icons/square";
import X from "@lucide/svelte/icons/x";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ResolvedHeaderType } from "./header-type";
import MacTrafficLight from "./MacTrafficLight.svelte";

type Props = {
  headerType: ResolvedHeaderType;
  maximized?: boolean;
  closeToTray?: boolean;
  quitting?: boolean;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  onClose?: () => void;
};

let {
  headerType,
  maximized = false,
  closeToTray = true,
  quitting = false,
  onMinimize,
  onToggleMaximize,
  onClose,
}: Props = $props();

const closeLabel = $derived(
  quitting
    ? "Closing Nerve"
    : closeToTray
      ? "Close window to tray"
      : "Close Nerve",
);
const closeTitle = $derived(
  quitting ? "Closing Nerve…" : closeToTray ? "Close to tray" : "Close Nerve",
);
</script>

{#if headerType === "macos"}
  <div
    class="group/window-controls mr-1.5 flex flex-none items-center gap-2 [-webkit-app-region:no-drag]"
    aria-label="Window controls"
  >
    <button
      type="button"
      class="size-3.5 rounded-full p-0 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      aria-label={closeLabel}
      title={closeTitle}
      disabled={quitting}
      onclick={() => onClose?.()}
    >
      {#if quitting}
        <Spinner class="size-3.5" />
      {:else}
        <MacTrafficLight kind="close" class="size-3.5" />
      {/if}
    </button>
    <button
      type="button"
      class="size-3.5 rounded-full p-0 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      aria-label="Minimize window"
      title="Minimize"
      disabled={quitting}
      onclick={() => onMinimize?.()}
    >
      <MacTrafficLight kind="minimize" class="size-3.5" />
    </button>
    <button
      type="button"
      class="size-3.5 rounded-full p-0 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      aria-label={maximized ? "Restore window" : "Maximize window"}
      title={maximized ? "Restore" : "Maximize"}
      disabled={quitting}
      onclick={() => onToggleMaximize?.()}
    >
      <MacTrafficLight kind="maximize" class="size-3.5" />
    </button>
  </div>
{:else if headerType === "windows"}
  <div
    class="flex flex-none items-center gap-0.5 [-webkit-app-region:no-drag]"
    aria-label="Window controls"
  >
    <Button
      variant="ghost"
      size="icon-sm"
      class="size-7 rounded-full"
      ariaLabel="Minimize window"
      title="Minimize"
      disabled={quitting}
      onclick={() => onMinimize?.()}
    >
      <Minus class="size-3.5" strokeWidth={1.75} />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      class="size-7 rounded-full"
      ariaLabel={maximized ? "Restore window" : "Maximize window"}
      title={maximized ? "Restore" : "Maximize"}
      disabled={quitting}
      onclick={() => onToggleMaximize?.()}
    >
      {#if maximized}
        <Copy class="size-3" strokeWidth={1.75} />
      {:else}
        <Square class="size-3" strokeWidth={1.75} />
      {/if}
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      class="size-7 rounded-full hover:bg-destructive-solid hover:text-destructive-solid-foreground focus-visible:bg-destructive-solid focus-visible:text-destructive-solid-foreground"
      ariaLabel={closeLabel}
      title={closeTitle}
      disabled={quitting}
      onclick={() => onClose?.()}
    >
      {#if quitting}
        <Spinner />
      {:else}
        <X class="size-3.5" strokeWidth={1.75} />
      {/if}
    </Button>
  </div>
{:else}
  <div
    class="flex flex-none items-center gap-0.5 [-webkit-app-region:no-drag]"
    aria-label="Window controls"
  >
    <Button
      variant="ghost"
      size="icon-sm"
      class="group/linux-control size-7 rounded-full hover:bg-transparent focus-visible:bg-transparent"
      ariaLabel="Minimize window"
      title="Minimize"
      disabled={quitting}
      onclick={() => onMinimize?.()}
    >
      <span
        class="flex size-4.5 items-center justify-center rounded-full group-hover/linux-control:bg-foreground group-hover/linux-control:text-background group-focus-visible/linux-control:bg-foreground group-focus-visible/linux-control:text-background"
      >
        <ChevronDown class="size-3.5" strokeWidth={2} />
      </span>
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      class="group/linux-control size-7 rounded-full hover:bg-transparent focus-visible:bg-transparent"
      ariaLabel={maximized ? "Restore window" : "Maximize window"}
      title={maximized ? "Restore" : "Maximize"}
      disabled={quitting}
      onclick={() => onToggleMaximize?.()}
    >
      <span
        class="flex size-4.5 items-center justify-center rounded-full group-hover/linux-control:bg-foreground group-hover/linux-control:text-background group-focus-visible/linux-control:bg-foreground group-focus-visible/linux-control:text-background"
      >
        {#if maximized}
          <Diamond class="size-2.5" strokeWidth={2} />
        {:else}
          <ChevronUp class="size-3.5" strokeWidth={2} />
        {/if}
      </span>
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      class="group/linux-control size-7 rounded-full hover:bg-transparent focus-visible:bg-transparent"
      ariaLabel={closeLabel}
      title={closeTitle}
      disabled={quitting}
      onclick={() => onClose?.()}
    >
      {#if quitting}
        <Spinner />
      {:else}
        <span
          class="flex size-4.5 items-center justify-center rounded-full group-hover/linux-control:bg-destructive/20 group-hover/linux-control:text-destructive group-focus-visible/linux-control:bg-destructive/20 group-focus-visible/linux-control:text-destructive"
        >
          <X class="size-3.5" strokeWidth={2} />
        </span>
      {/if}
    </Button>
  </div>
{/if}
