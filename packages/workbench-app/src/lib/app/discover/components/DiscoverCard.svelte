<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import Blocks from "@lucide/svelte/icons/blocks";
import Check from "@lucide/svelte/icons/check";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import Compass from "@lucide/svelte/icons/compass";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import KeyRound from "@lucide/svelte/icons/key-round";
import Lightbulb from "@lucide/svelte/icons/lightbulb";
import Mic from "@lucide/svelte/icons/mic";
import Newspaper from "@lucide/svelte/icons/newspaper";
import PanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
import Search from "@lucide/svelte/icons/search";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import type { Component } from "svelte";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Card, CardContent } from "@nervekit/ui-kit/components/ui/card";
import type { ResolvedDiscoverEditorial } from "../policy.js";
import type { DiscoverEditorialAction } from "../catalog.js";
import type { GuideId, GuidePriority } from "../guides/catalog.js";
import type { ResolvedGuide } from "../guides/catalog-policy.js";

type Props = {
  guide?: ResolvedGuide;
  editorial?: ResolvedDiscoverEditorial;
  workbenchBlocked?: boolean;
  subdued?: boolean;
  onStartGuide: (id: GuideId) => void;
  onMarkCompleted: (id: GuideId) => void;
  onEditorialAction: (action: DiscoverEditorialAction) => void;
};

let {
  guide,
  editorial,
  workbenchBlocked = false,
  subdued = false,
  onStartGuide,
  onMarkCompleted,
  onEditorialAction,
}: Props = $props();

const guideIcons: Record<GuideId, Component> = {
  atlassian: Blocks,
  "open-project": FolderOpen,
  provider: KeyRound,
  voice: Mic,
  "scoped-models": SlidersHorizontal,
  "agent-defaults": Bot,
  "web-search": Search,
  workbench: PanelsTopLeft,
};

const priorityLabel: Record<GuidePriority, string> = {
  "must-do": "Must do",
  "highly-recommended": "Recommended",
  optional: "Optional",
};

const Icon = $derived(
  guide
    ? guideIcons[guide.id]
    : editorial?.kind === "highlight"
      ? Newspaper
      : editorial?.kind === "tip"
        ? Lightbulb
        : Compass,
);

function guideActionLabel(item: ResolvedGuide): string {
  if (item.id === "workbench" && workbenchBlocked)
    return "Open a project first";
  if (item.completed)
    return item.run?.kind === "workbench-tour" ? "Replay tour" : "Replay guide";
  return item.actionLabel ?? "Got it";
}

const cardTone = $derived(
  subdued
    ? "bg-muted/20 shadow-none"
    : guide &&
        !guide.completed &&
        guide.available &&
        guide.priority === "must-do"
      ? "bg-warning/8"
      : "",
);
</script>

<Card size="sm" class="h-full rounded-md {cardTone}">
  <CardContent class="flex h-full flex-col gap-2.5">
    <div class="flex items-start gap-2.5">
      <div
        class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
      >
        <Icon class="size-3.5" aria-hidden="true" />
      </div>
      <div class="grid min-w-0 flex-1 gap-1">
        <div class="flex flex-wrap items-center gap-1.5">
          <h3 class="text-sm font-semibold leading-tight">
            {guide?.title ?? editorial?.title}
          </h3>
          {#if editorial?.new}
            <Badge tone="running" size="xs">New</Badge>
          {:else if guide?.lifecycle === "new"}
            <Badge tone="running" size="xs">New</Badge>
          {/if}
        </div>
        <div
          class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
        >
          {#if guide?.completed}
            <span class="inline-flex items-center gap-1 text-success">
              <CircleCheck class="size-3.5" aria-hidden="true" />
              Completed
            </span>
          {:else if guide}
            <span
              class={guide.priority === "must-do"
                ? "font-medium text-warning"
                : ""}
            >
              {priorityLabel[guide.priority]}
            </span>
            <span aria-hidden="true">·</span>
            <span>{guide.category === "setup" ? "Setup" : "Walkthrough"}</span>
          {:else if editorial}
            <span
              >{editorial.releaseLabel ??
                (editorial.kind === "tip" ? "Tip" : "Highlight")}</span
            >
            {#if editorial.unseen}
              <span aria-hidden="true">·</span>
              <span class="font-medium text-info">Unread</span>
            {/if}
          {/if}
        </div>
      </div>
    </div>

    <p
      class="text-xs leading-relaxed text-muted-foreground {subdued
        ? 'line-clamp-1'
        : ''}"
    >
      {guide?.description ?? editorial?.description}
    </p>

    {#if guide?.id === "workbench" && workbenchBlocked}
      <p class="text-xs text-muted-foreground">
        Open a project before starting this tour.
      </p>
    {/if}

    <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
      {#if guide}
        {#if !guide.available}
          <p class="text-xs text-muted-foreground">
            This guide will become available with a future release.
          </p>
        {:else if guide.run || !guide.completed}
          <Button
            variant={guide.completed ? "outline" : "default"}
            size="xs"
            onclick={() => onStartGuide(guide.id)}
          >
            {guideActionLabel(guide)}
          </Button>
          {#if guide.run && !guide.completed}
            <Button
              variant="ghost"
              size="xs"
              onclick={() => onMarkCompleted(guide.id)}
            >
              <Check class="size-3" aria-hidden="true" />
              Mark completed
            </Button>
          {/if}
        {/if}
      {:else if editorial?.action}
        <Button
          variant="outline"
          size="xs"
          onclick={() => onEditorialAction(editorial.action!)}
        >
          {editorial.action.label}
        </Button>
      {/if}
    </div>
  </CardContent>
</Card>
