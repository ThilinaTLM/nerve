<!--
  Shown only when a value differs from where it would otherwise come from (for
  example, a project setting that differs from the user's). The dot opens a
  popover that explains why; ↺ puts the inherited value back.
-->
<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import Popover, {
  PopoverBody,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";

type Props = {
  /** What the value would be otherwise, e.g. "User: Claude Sonnet 4.5". */
  from: string;
  /** The current value with its source, e.g. "This project: GPT-5". */
  to: string;
  title?: string;
  resetLabel?: string;
  onReset: () => void;
  /** Dot only; the reset lives in the popover (dense grids). */
  compact?: boolean;
};

let {
  from,
  to,
  title = "Changed for this project",
  resetLabel = "Reset to user setting",
  onReset,
  compact = false,
}: Props = $props();

let open = $state(false);
</script>

<span class="inline-flex items-center gap-0.5">
  <Popover
    bind:open
    size="sm"
    align="start"
    ariaLabel={`${title}. ${from} → ${to}`}
    triggerClass="inline-flex size-4 cursor-pointer items-center justify-center rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
  >
    {#snippet trigger()}
      <span class="size-2 rounded-full bg-info" aria-hidden="true"></span>
    {/snippet}
    <PopoverHeader {title} />
    <PopoverBody>
      <div class="grid gap-2 px-2.5 pb-2 text-xs">
        <p class="text-muted-foreground">{from}</p>
        <p class="flex items-center gap-1.5 text-foreground">
          <ArrowRight
            class="size-3 flex-none text-muted-foreground"
            aria-hidden="true"
          />
          {to}
        </p>
        <Button
          size="sm"
          variant="outline"
          class="w-fit"
          onclick={() => {
            open = false;
            onReset();
          }}
        >
          <RotateCcw class="size-3" aria-hidden="true" />
          {resetLabel}
        </Button>
      </div>
    </PopoverBody>
  </Popover>
  {#if !compact}
    <IconAction icon={RotateCcw} label={resetLabel} onclick={onReset} />
  {/if}
</span>
