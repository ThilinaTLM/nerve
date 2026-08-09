<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Bot from "@lucide/svelte/icons/bot";
import Check from "@lucide/svelte/icons/check";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleDashed from "@lucide/svelte/icons/circle-dashed";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import KeyRound from "@lucide/svelte/icons/key-round";
import Mic from "@lucide/svelte/icons/mic";
import PanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
import Search from "@lucide/svelte/icons/search";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import type { Component } from "svelte";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import type { GuideId } from "../guide-catalog.js";
import type { ResolvedGuide } from "../guide-catalog-policy.js";

type Props = {
  guide: ResolvedGuide;
  summary?: string;
  index: number;
  count: number;
  workbenchBlocked: boolean;
  onBack: () => void;
  onNext: () => void;
  onStart: () => void;
  onMarkCompleted: () => void;
  onLater: () => void;
};

let {
  guide,
  summary,
  index,
  count,
  workbenchBlocked,
  onBack,
  onNext,
  onStart,
  onMarkCompleted,
  onLater,
}: Props = $props();

const icons: Record<GuideId, Component> = {
  "open-project": FolderOpen,
  provider: KeyRound,
  voice: Mic,
  "scoped-models": SlidersHorizontal,
  "agent-defaults": Bot,
  "web-search": Search,
  workbench: PanelsTopLeft,
};

const Icon = $derived(icons[guide.id]);
const last = $derived(index === count - 1);
const actionLabel = $derived(
  guide.id === "workbench" && workbenchBlocked
    ? "Open project guide"
    : guide.completed
      ? guide.run?.kind === "workbench-tour"
        ? "Replay tour"
        : "Replay guide"
      : (guide.actionLabel ?? "Got it"),
);
const priorityLabel = $derived(
  guide.priority === "must-do"
    ? "Must do"
    : guide.priority === "highly-recommended"
      ? "Highly recommended"
      : "Optional",
);
const navigationIsPrimary = $derived(guide.completed || !guide.available);
</script>

<Dialog
  open
  size="md"
  title="Nerve guides"
  description="Learn the essentials and explore Workbench features at your own pace."
  closeLabel="Later"
  onOpenChange={(open) => {
    if (!open) onLater();
  }}
>
  <div class="grid gap-6">
    <div class="grid gap-2">
      <div
        class="flex items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <span>Guide {index + 1} of {count}</span>
        <span>{guide.title}</span>
      </div>
      <Progress
        value={index + 1}
        max={count}
        aria-label={`Guide ${index + 1} of ${count}`}
      />
    </div>

    <section
      class="grid min-h-56 content-center gap-4 px-2 py-3 sm:grid-cols-[auto_1fr] sm:items-start sm:px-5"
      aria-live="polite"
      aria-labelledby="current-guide-title"
    >
      <div
        class="flex size-11 items-center justify-center rounded-lg bg-muted text-foreground"
      >
        <Icon class="size-5" aria-hidden="true" />
      </div>

      <div class="grid max-w-lg gap-4">
        <div class="grid gap-1.5">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span
              class={guide.priority === "must-do"
                ? "font-medium text-warning"
                : "font-medium text-muted-foreground"}
            >
              {priorityLabel}
            </span>
            {#if guide.lifecycle === "new"}
              <span class="text-info">New</span>
            {:else if guide.lifecycle === "upcoming"}
              <span class="text-muted-foreground">Upcoming</span>
            {/if}
            <span class="text-border" aria-hidden="true">·</span>
            <span
              class={guide.completed
                ? "inline-flex items-center gap-1 text-success"
                : "inline-flex items-center gap-1 text-muted-foreground"}
            >
              {#if guide.completed}
                <CircleCheck class="size-3.5" aria-hidden="true" />
                Completed
              {:else}
                <CircleDashed class="size-3.5" aria-hidden="true" />
                Not completed
              {/if}
            </span>
          </div>
          <h2 id="current-guide-title" class="text-lg font-semibold">
            {guide.title}
          </h2>
          <p class="text-sm leading-relaxed text-muted-foreground">
            {guide.description}
          </p>
        </div>

        {#if summary || (guide.id === "workbench" && workbenchBlocked)}
          <div
            class="border-l-2 border-border pl-3 text-xs text-muted-foreground"
          >
            {#if guide.id === "workbench" && workbenchBlocked}
              Open a project before starting this tour.
            {:else}
              {summary}
            {/if}
          </div>
        {/if}

        {#if guide.available}
          <div class="flex flex-wrap items-center gap-2">
            {#if guide.run || !guide.completed}
              <Button
                variant={guide.completed ? "outline" : "default"}
                size="sm"
                onclick={onStart}
              >
                {actionLabel}
              </Button>
            {/if}
            {#if guide.run && !guide.completed}
              <Button variant="ghost" size="sm" onclick={onMarkCompleted}>
                <Check class="size-4" aria-hidden="true" />
                Mark completed
              </Button>
            {/if}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">
            This guide will become available with a future release.
          </p>
        {/if}
      </div>
    </section>
  </div>

  {#snippet footer()}
    <div class="flex w-full flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onclick={onLater}>Later</Button>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={onBack}
          disabled={index === 0}
        >
          <ArrowLeft class="size-4" aria-hidden="true" />
          Back
        </Button>
        {#if last}
          <Button
            variant={navigationIsPrimary ? "default" : "outline"}
            size="sm"
            onclick={onLater}
          >
            <Check class="size-4" aria-hidden="true" />
            Done
          </Button>
        {:else}
          <Button
            variant={navigationIsPrimary ? "default" : "outline"}
            size="sm"
            onclick={onNext}
          >
            Next
            <ArrowRight class="size-4" aria-hidden="true" />
          </Button>
        {/if}
      </div>
    </div>
  {/snippet}
</Dialog>
