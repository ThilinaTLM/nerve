<script lang="ts">
import type { LatestRelease } from "@nervekit/contracts/status";
import Check from "@lucide/svelte/icons/check";
import Copy from "@lucide/svelte/icons/copy";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Popover, {
  PopoverBody,
  PopoverFooter,
  PopoverHeader,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { onDestroy } from "svelte";
import { scale } from "svelte/transition";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { displayVersion, isVersionOutdated } from "$lib/features/releases";

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
  outdated && latestLabel
    ? `Nerve ${currentLabel}; update available: ${latestLabel}`
    : latestLabel
      ? `Nerve ${currentLabel}; no newer stable release detected`
      : `Nerve ${currentLabel}; latest release check unavailable`,
);
const latestCommand = "npx @nervekit/desktop@latest";
const pinnedCommand = $derived(
  latestRelease ? `npx @nervekit/desktop@${latestRelease.version}` : "",
);
let copiedCommand = $state<"latest" | "pinned" | undefined>();
let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

async function copyCommand(
  command: string,
  commandId: "latest" | "pinned",
): Promise<void> {
  try {
    await writeClipboardText(command);
  } catch {
    return;
  }
  copiedCommand = commandId;
  if (copyResetTimer !== undefined) clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    copiedCommand = undefined;
    copyResetTimer = undefined;
  }, 1_500);
}

onDestroy(() => {
  if (copyResetTimer !== undefined) clearTimeout(copyResetTimer);
});
</script>

<span
  class={`version-indicator inline-flex ${outdated ? "" : "max-sm:hidden"}`}
>
  <Popover
    ariaLabel={accessibleLabel}
    side="bottom"
    align="end"
    size="md"
    triggerClass={`cursor-pointer rounded-sm border border-border bg-transparent px-1.5 py-0.5 font-mono text-xs font-medium leading-none text-muted-foreground transition-colors hover:bg-accent ${outdated ? "is-outdated" : ""}`}
  >
    {#snippet trigger()}{currentLabel}{/snippet}

    <PopoverHeader
      title="Nerve"
      meta={latestLabel
        ? `${currentLabel} · latest ${latestLabel}`
        : currentLabel}
    />

    <PopoverBody>
      {#if outdated && latestLabel && latestRelease}
        <p class="px-1.5 text-warning">
          This version is out of date. Update to {latestLabel} to use the latest stable
          release.
        </p>
        <PopoverSection label="Run the latest release" separated>
          <div class="flex items-center rounded-sm bg-muted pl-2 pr-1">
            <code class="min-w-0 flex-1 select-text py-1.5 text-foreground"
              >{latestCommand}</code
            >
            <Button
              variant="ghost"
              size="icon-xs"
              ariaLabel={copiedCommand === "latest"
                ? "Latest release command copied"
                : "Copy latest release command"}
              title={copiedCommand === "latest" ? "Copied" : "Copy command"}
              onclick={() => void copyCommand(latestCommand, "latest")}
            >
              {#key copiedCommand === "latest"}
                {#if copiedCommand === "latest"}
                  <span
                    class="inline-flex"
                    transition:scale={{ duration: 120 }}
                  >
                    <Check class="size-3.5 text-success" aria-hidden="true" />
                  </span>
                {:else}
                  <span
                    class="inline-flex"
                    transition:scale={{ duration: 120 }}
                  >
                    <Copy class="size-3.5" aria-hidden="true" />
                  </span>
                {/if}
              {/key}
            </Button>
          </div>
          <span class="mt-1 px-1.5 text-muted-foreground">
            Or pin this release
          </span>
          <div class="flex items-center rounded-sm bg-muted pl-2 pr-1">
            <code class="min-w-0 flex-1 select-text py-1.5 text-foreground"
              >{pinnedCommand}</code
            >
            <Button
              variant="ghost"
              size="icon-xs"
              ariaLabel={copiedCommand === "pinned"
                ? "Pinned release command copied"
                : "Copy pinned release command"}
              title={copiedCommand === "pinned" ? "Copied" : "Copy command"}
              onclick={() => void copyCommand(pinnedCommand, "pinned")}
            >
              {#key copiedCommand === "pinned"}
                {#if copiedCommand === "pinned"}
                  <span
                    class="inline-flex"
                    transition:scale={{ duration: 120 }}
                  >
                    <Check class="size-3.5 text-success" aria-hidden="true" />
                  </span>
                {:else}
                  <span
                    class="inline-flex"
                    transition:scale={{ duration: 120 }}
                  >
                    <Copy class="size-3.5" aria-hidden="true" />
                  </span>
                {/if}
              {/key}
            </Button>
          </div>
        </PopoverSection>
      {:else if latestLabel}
        <p class="px-1.5 text-muted-foreground">
          No newer stable release is available.
        </p>
      {:else}
        <p class="px-1.5 text-muted-foreground">
          The latest release could not be checked. Nerve will retry
          automatically.
        </p>
      {/if}
    </PopoverBody>

    {#if latestRelease}
      <PopoverFooter>
        <Button
          variant="ghost"
          size="xs"
          href={latestRelease.releaseUrl}
          target="_blank"
          rel="noreferrer"
        >
          Release notes
        </Button>
      </PopoverFooter>
    {/if}
  </Popover>
</span>

<style>
/* The Bits UI trigger is rendered by PopoverPanel, so it cannot be reached by
 * this component's scoping. Keep the reach-in confined to the local wrapper.
 * The outdated fill is an opaque two-token mix (escape-hatch reason 8) and has
 * no Tailwind opacity equivalent. */
.version-indicator :global(.popover-trigger.is-outdated) {
  border-color: var(--warning);
  background: color-mix(in oklab, var(--warning) 10%, var(--card));
  color: var(--warning);
}

.version-indicator :global(.popover-trigger.is-outdated:hover) {
  background: color-mix(in oklab, var(--warning) 16%, var(--card));
}
</style>
