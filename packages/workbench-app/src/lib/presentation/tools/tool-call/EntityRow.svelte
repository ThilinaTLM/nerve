<script lang="ts">
// One entity (sub-agent, ...) as a sheet section: static status dot, title,
// detail, optional follow-up mark and Open pill, and a clamped body line.
// Undefined slots render skeletons that are replaced in place by the value.
import ListEnd from "@lucide/svelte/icons/list-end";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import { cn } from "@nervekit/ui-kit/utils";
import SlotText from "../../cards/SlotText.svelte";

type Props = {
  title?: string;
  detail?: string;
  body?: string;
  status?: { tone: StatusTone; label: string };
  followUp?: boolean;
  /** Open pill; omitted when there is nothing to open. */
  onOpen?: () => void;
  /** Argument text is still streaming in. */
  streaming?: boolean;
  /** Row appeared after the card mounted. */
  enter?: boolean;
  /** Show the whole body instead of clamping it. */
  expanded?: boolean;
};
let {
  title,
  detail,
  body,
  status,
  followUp = false,
  onOpen,
  streaming = false,
  enter = false,
  expanded = false,
}: Props = $props();

// Same pill classes as the card footer actions.
const pill =
  "inline-flex min-h-5 flex-none cursor-pointer items-center rounded-sm border border-border bg-well px-1.5 py-0.5 text-xs leading-none font-medium text-primary hover:underline";
</script>

<div class={cn("grid min-w-0 gap-0.5 px-3 py-2", enter && "stream-item-enter")}>
  <div class="flex min-w-0 items-center gap-2">
    <span class="inline-flex size-3 flex-none items-center justify-center">
      {#if status}
        <!-- Static dot, never a spinner: agent rows can stay running for
             minutes. Tone carries the state; the tooltip names it. -->
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger
              aria-label={`${title ?? "Item"}: ${status.label}`}
              class="inline-flex cursor-help items-center rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <StatusDot
                tone={status.tone}
                size="xs"
                class="transition-colors duration-300"
              />
            </Tooltip.Trigger>
            <Tooltip.Content>{status.label}</Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      {:else if streaming || title === undefined}
        <Skeleton class="size-2 rounded-full bg-foreground/10" />
      {/if}
    </span>
    <SlotText
      text={title}
      width="w-32"
      {streaming}
      class="text-sm font-medium text-foreground"
    />
    {#if detail !== undefined || title === undefined}
      <SlotText
        text={detail}
        width="w-14"
        {streaming}
        class="text-xs text-muted-foreground"
      />
    {/if}
    {#if followUp}
      <Tooltip.Provider delayDuration={200}>
        <Tooltip.Root>
          <Tooltip.Trigger
            aria-label="Follow-up to existing subagent"
            class="inline-flex flex-none cursor-help items-center rounded-sm text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ListEnd class="size-3.5" aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Content>Follow-up to existing subagent</Tooltip.Content>
        </Tooltip.Root>
      </Tooltip.Provider>
    {/if}
    {#if onOpen}
      <span class="ml-auto flex flex-none items-center">
        <button
          class={pill}
          type="button"
          aria-label={`Open ${title ?? "item"}`}
          onclick={onOpen}>Open</button
        >
      </span>
    {/if}
  </div>
  {#if body !== undefined || streaming}
    <p
      class={cn(
        "m-0 pl-5 text-xs whitespace-pre-line text-muted-foreground wrap-anywhere",
        !expanded && "line-clamp-2",
      )}
    >
      <SlotText text={body} width="w-3/4" {streaming} class="w-full" />
    </p>
  {/if}
</div>
