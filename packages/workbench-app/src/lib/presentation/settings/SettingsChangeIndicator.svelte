<!--
  Shown only when a value differs from where it would otherwise come from: a
  user setting that differs from the built-in default, or a project setting
  that differs from the user's. The dot opens a popover that explains why; ↺
  puts the inherited value back.
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
  /** The scope being edited; decides the inherited layer's name. */
  scope: "user" | "project";
  /** The inherited value, e.g. "Claude Sonnet 4.5". */
  from: string;
  /** The value set at this scope, e.g. "GPT-5". */
  to: string;
  onReset: () => void;
  /** Dot only; the reset lives in the popover (dense grids). */
  compact?: boolean;
};

let { scope, from, to, onReset, compact = false }: Props = $props();

const labels = $derived(
  scope === "project"
    ? {
        title: "Changed for this project",
        from: "User",
        to: "This project",
        reset: "Reset to user setting",
      }
    : {
        title: "Changed from default",
        from: "Default",
        to: "User",
        reset: "Reset to default",
      },
);
const title = $derived(labels.title);
const resetLabel = $derived(labels.reset);
const fromText = $derived(`${labels.from}: ${from}`);
const toText = $derived(`${labels.to}: ${to}`);

let open = $state(false);
</script>

<span class="inline-flex items-center gap-0.5">
  <Popover
    bind:open
    size="sm"
    align="start"
    ariaLabel={`${title}. ${fromText} → ${toText}`}
    triggerClass="inline-flex size-4 cursor-pointer items-center justify-center rounded-full focus-visible:ring-3 focus-visible:ring-focus focus-visible:outline-none"
  >
    {#snippet trigger()}
      <span class="size-2 rounded-full bg-info" aria-hidden="true"></span>
    {/snippet}
    <PopoverHeader {title} />
    <PopoverBody>
      <div class="grid gap-2 px-2.5 pb-2 text-ui">
        <p class="text-muted-foreground">{fromText}</p>
        <p class="flex items-center gap-1.5 text-foreground">
          <ArrowRight
            class="size-3 flex-none text-muted-foreground"
            aria-hidden="true"
          />
          {toText}
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
