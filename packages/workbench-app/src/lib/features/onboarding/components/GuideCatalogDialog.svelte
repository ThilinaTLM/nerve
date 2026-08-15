<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import Check from "@lucide/svelte/icons/check";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import KeyRound from "@lucide/svelte/icons/key-round";
import Mic from "@lucide/svelte/icons/mic";
import PanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
import Search from "@lucide/svelte/icons/search";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import type { Component } from "svelte";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Card, CardContent } from "@nervekit/ui-kit/components/ui/card";
import { Progress } from "@nervekit/ui-kit/components/ui/progress";
import type { GuideId, GuidePriority } from "../guide-catalog.js";
import type { ResolvedGuide } from "../guide-catalog-policy.js";

type Props = {
  guides: ResolvedGuide[];
  workbenchBlocked: boolean;
  onStartGuide: (id: GuideId) => void;
  onMarkCompleted: (id: GuideId) => void;
  onLater: () => void;
};

let {
  guides,
  workbenchBlocked,
  onStartGuide,
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

const priorityRank: Record<GuidePriority, number> = {
  "must-do": 0,
  "highly-recommended": 1,
  optional: 2,
};

const priorityLabel: Record<GuidePriority, string> = {
  "must-do": "Must do",
  "highly-recommended": "Highly recommended",
  optional: "Optional",
};

// Incomplete guides first (catalog order within each completion state) so the
// actionable work is visible without scrolling past finished guides.
const orderedGuides = $derived(
  [...guides].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      priorityRank[a.priority] - priorityRank[b.priority],
  ),
);

const completedCount = $derived(
  guides.filter((guide) => guide.completed).length,
);

function actionLabel(guide: ResolvedGuide): string {
  if (guide.id === "workbench" && workbenchBlocked)
    return "Open a project first";
  if (guide.completed) {
    return guide.run?.kind === "workbench-tour"
      ? "Replay tour"
      : "Replay guide";
  }
  return guide.actionLabel ?? "Got it";
}

// Incomplete must-do and highly-recommended guides get a subtle tint so the
// next best actions stand out; optional and completed guides stay neutral.
function cardToneClass(guide: ResolvedGuide): string {
  if (guide.completed || !guide.available) return "";
  if (guide.priority === "must-do") return "bg-warning/10";
  if (guide.priority === "highly-recommended") return "bg-primary/10";
  return "";
}
</script>

<Dialog
  open
  size="xl"
  title="Nerve guides"
  description="Learn the essentials and explore Workbench features at your own pace."
  closeLabel="Later"
  onOpenChange={(open) => {
    if (!open) onLater();
  }}
>
  <div class="grid gap-5">
    <div class="grid gap-1.5">
      <div
        class="flex items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <span>
          {completedCount} of {guides.length} complete
        </span>
        <span>{guides.length} guides</span>
      </div>
      <Progress
        value={completedCount}
        max={guides.length}
        aria-label={`${completedCount} of ${guides.length} guides complete`}
      />
    </div>

    <div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {#each orderedGuides as guide (guide.id)}
        {@const Icon = icons[guide.id]}
        <Card size="sm" class="h-full {cardToneClass(guide)}">
          <CardContent class="flex h-full flex-col gap-2.5">
            <div class="flex items-start gap-2.5">
              <div
                class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
              >
                <Icon class="size-4" aria-hidden="true" />
              </div>
              <div class="grid min-w-0 flex-1 gap-0.5">
                <h3 class="truncate text-sm font-semibold leading-tight">
                  {guide.title}
                </h3>
                <p
                  class="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
                >
                  {#if guide.completed}
                    <span class="inline-flex items-center gap-1 text-success">
                      <CircleCheck class="size-3.5" aria-hidden="true" />
                      Completed
                    </span>
                  {:else}
                    <span
                      class={guide.priority === "must-do"
                        ? "font-medium text-warning"
                        : "text-muted-foreground"}
                    >
                      {priorityLabel[guide.priority]}
                    </span>
                  {/if}
                  {#if guide.lifecycle === "new"}
                    <span class="font-medium text-info">New</span>
                  {:else if guide.lifecycle === "upcoming"}
                    <span>Upcoming</span>
                  {/if}
                </p>
              </div>
            </div>

            <p
              class="line-clamp-2 text-xs leading-relaxed text-muted-foreground"
            >
              {guide.description}
            </p>

            {#if guide.id === "workbench" && workbenchBlocked}
              <p class="text-xs text-muted-foreground">
                Open a project before starting this tour.
              </p>
            {/if}

            {#if guide.available && (guide.run || !guide.completed)}
              <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                <Button
                  variant={guide.completed ? "outline" : "default"}
                  size="xs"
                  onclick={() => onStartGuide(guide.id)}
                >
                  {actionLabel(guide)}
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
              </div>
            {:else}
              <p class="text-xs text-muted-foreground">
                This guide will become available with a future release.
              </p>
            {/if}
          </CardContent>
        </Card>
      {/each}
    </div>
  </div>

  {#snippet footer()}
    <div class="flex w-full flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onclick={onLater}>Later</Button>
      <Button variant="default" size="sm" onclick={onLater}>
        <Check class="size-4" aria-hidden="true" />
        Done
      </Button>
    </div>
  {/snippet}
</Dialog>
