<script lang="ts">
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { displayVersion, isVersionOutdated } from "$lib/features/releases";
import type { DiscoverAction } from "../content/entries.js";
import type { GuideId } from "../guides/catalog.js";
import type { DiscoverPageModel } from "../state.svelte.js";
import DiscoverNewsSection from "./DiscoverNewsSection.svelte";
import DiscoverResourceLinks from "./DiscoverResourceLinks.svelte";
import DiscoverSetupSection from "./DiscoverSetupSection.svelte";
import DiscoverTipsSection from "./DiscoverTipsSection.svelte";
import DiscoverWalkthroughSection from "./DiscoverWalkthroughSection.svelte";

type Props = {
  model: DiscoverPageModel;
  workbenchBlocked: boolean;
  onStartGuide: (id: GuideId) => void;
  onMarkCompleted: (id: GuideId) => void;
  onAction: (action: DiscoverAction) => void;
  onSetAutoOpen: (enabled: boolean) => void;
};

let {
  model,
  workbenchBlocked,
  onStartGuide,
  onMarkCompleted,
  onAction,
  onSetAutoOpen,
}: Props = $props();

const versionLabel = $derived(
  model.currentVersion ? displayVersion(model.currentVersion) : undefined,
);
const outdated = $derived(
  isVersionOutdated(model.currentVersion, model.latestVersion),
);
</script>

<div class="h-full min-h-0 bg-background">
  <ScrollArea class="h-full">
    <main class="mx-auto grid w-full max-w-4xl gap-6 px-4 py-5 sm:px-6">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="grid gap-0.5">
          <h1 class="text-base font-semibold text-foreground">Discover</h1>
          <p class="text-sm text-muted-foreground">
            What's new in Nerve, plus setup guides and everyday tips.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          {#if versionLabel}
            <Badge variant="outline">{versionLabel}</Badge>
          {/if}
          {#if outdated && model.latestVersion}
            <Badge variant="warning" href={model.latestReleaseUrl}>
              Update to {displayVersion(model.latestVersion)}
            </Badge>
          {/if}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class={buttonVariants({ variant: "ghost", size: "icon-xs" })}
              aria-label="Discover options"
              title="Discover options"
            >
              <Ellipsis class="size-4" aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="w-60">
              <DropdownMenu.CheckboxItem
                checked={model.autoOpenEnabled}
                onCheckedChange={(checked) => onSetAutoOpen(checked)}
              >
                Open Discover after updates
              </DropdownMenu.CheckboxItem>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </header>

      <DiscoverNewsSection
        news={model.sections.news}
        currentVersion={versionLabel}
        {onAction}
      />

      <DiscoverSetupSection
        setup={model.sections.setup}
        {onStartGuide}
        {onMarkCompleted}
      />

      {#if model.sections.walkthroughs.length > 0}
        <DiscoverWalkthroughSection
          walkthroughs={model.sections.walkthroughs}
          {workbenchBlocked}
          {onStartGuide}
        />
      {/if}

      {#if model.sections.tips.length > 0}
        <DiscoverTipsSection tips={model.sections.tips} {onAction} />
      {/if}

      <DiscoverResourceLinks />
    </main>
  </ScrollArea>
</div>
