<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Bot from "@lucide/svelte/icons/bot";
import Check from "@lucide/svelte/icons/check";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import KeyRound from "@lucide/svelte/icons/key-round";
import Mic from "@lucide/svelte/icons/mic";
import PanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import type { Component } from "svelte";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import type { GuideId } from "../guide-catalog.js";
import type { ResolvedGuide } from "../guide-catalog-policy.js";

type Props = {
  guide: ResolvedGuide;
  summary?: string;
  index: number;
  count: number;
  completedCount: number;
  completionTotal: number;
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
  completedCount,
  completionTotal,
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
        : guide.run?.kind === "open-project"
          ? "Open another project"
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
  <div class="grid gap-5" aria-live="polite">
    <div
      class="grid gap-2"
      aria-label={`${completedCount} of ${completionTotal} available guides completed`}
    >
      <div
        class="flex items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <span>Guide {index + 1} of {count}</span>
        <span>{completedCount} completed</span>
      </div>
      <Progress
        value={completedCount}
        max={completionTotal}
        aria-label="Guide completion progress"
      />
    </div>

    <Empty.Root class="min-h-72 border-0 p-4">
      <Empty.Media variant="icon" class="size-14 rounded-xl">
        <Icon class="size-7" aria-hidden="true" />
      </Empty.Media>
      <Empty.Header>
        <div class="flex flex-wrap items-center justify-center gap-1.5">
          <Badge
            tone={guide.priority === "must-do" ? "warn" : "neutral"}
            size="xs"
          >
            {priorityLabel}
          </Badge>
          {#if guide.lifecycle === "new"}
            <Badge tone="accent" size="xs">New</Badge>
          {:else if guide.lifecycle === "upcoming"}
            <Badge tone="neutral" size="xs">Upcoming</Badge>
          {/if}
          <Badge tone={guide.completed ? "good" : "neutral"} size="xs">
            {guide.completed ? "Completed" : "Not completed"}
          </Badge>
        </div>
        <Empty.Title>{guide.title}</Empty.Title>
        <Empty.Description>{guide.description}</Empty.Description>
      </Empty.Header>

      <Empty.Content class="w-full max-w-md gap-3">
        {#if summary}
          <p class="text-center text-xs text-muted-foreground">{summary}</p>
        {/if}
        {#if guide.id === "workbench" && workbenchBlocked}
          <p class="text-center text-xs text-warning">
            Open a project before starting this tour.
          </p>
        {/if}
        {#if guide.available}
          <div class="flex flex-wrap items-center justify-center gap-2">
            {#if guide.run || !guide.completed}
              <Button onclick={onStart}>{actionLabel}</Button>
            {/if}
            {#if guide.run && !guide.completed}
              <Button variant="outline" onclick={onMarkCompleted}>
                <Check class="size-4" aria-hidden="true" />
                Mark completed
              </Button>
            {/if}
          </div>
        {:else}
          <p class="text-center text-sm text-muted-foreground">
            This guide will become available with a future release.
          </p>
        {/if}
      </Empty.Content>
    </Empty.Root>
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
          <Button size="sm" onclick={onLater}>
            <Check class="size-4" aria-hidden="true" />
            Done
          </Button>
        {:else}
          <Button size="sm" onclick={onNext}>
            Next
            <ArrowRight class="size-4" aria-hidden="true" />
          </Button>
        {/if}
      </div>
    </div>
  {/snippet}
</Dialog>
