<!--
  @component
  Titlebar "Update" button, shown only while a newer stable release exists;
  its popover says which and how to run it. The current version itself is in
  the daemon status popover and Settings › About.
-->
<script lang="ts">
import type { LatestRelease } from "@nervekit/contracts/status";
import CircleArrowUp from "@lucide/svelte/icons/circle-arrow-up";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Popover, {
  PopoverBody,
  PopoverFooter,
  PopoverHeader,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import {
  displayVersion,
  isVersionOutdated,
  ReleaseCommands,
} from "$lib/features/releases";

type Props = {
  currentVersion: string;
  latestRelease?: LatestRelease;
};

let { currentVersion, latestRelease }: Props = $props();

const currentLabel = $derived(displayVersion(currentVersion));
const latestLabel = $derived(
  latestRelease ? displayVersion(latestRelease.version) : undefined,
);
const outdated = $derived(
  isVersionOutdated(currentVersion, latestRelease?.version),
);
const accessibleLabel = $derived(
  `Update available: ${latestLabel ?? ""}, running ${currentLabel}`,
);
</script>

{#if outdated && latestRelease && latestLabel}
  <Popover ariaLabel={accessibleLabel} side="bottom" align="end" size="md">
    {#snippet triggerChild({ props })}
      <Button
        {...props}
        variant="ghost"
        class="text-warning hover:text-warning aria-expanded:text-warning"
        ariaLabel={accessibleLabel}
        title="Update available"
      >
        <CircleArrowUp class="size-4" aria-hidden="true" />
        Update
      </Button>
    {/snippet}

    <PopoverHeader
      title="Nerve"
      meta={`${currentLabel} · latest ${latestLabel}`}
    />

    <PopoverBody>
      <p class="px-1.5 text-warning">
        This version is out of date. Update to {latestLabel} to use the latest stable
        release.
      </p>
      <PopoverSection label="Run the latest release" separated>
        <ReleaseCommands version={latestRelease.version} />
      </PopoverSection>
    </PopoverBody>

    <PopoverFooter>
      <Button
        variant="ghost"
        size="sm"
        href={latestRelease.releaseUrl}
        target="_blank"
        rel="noreferrer"
      >
        Release notes
      </Button>
    </PopoverFooter>
  </Popover>
{/if}
