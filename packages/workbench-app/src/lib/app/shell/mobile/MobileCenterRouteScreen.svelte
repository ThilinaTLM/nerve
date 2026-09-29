<script lang="ts">
import type { Component } from "svelte";
import { MobileScreen } from "$lib/presentation/shell";
import LazyViewPending from "$lib/app/shell/LazyViewPending.svelte";
import {
  centerViewLoaders,
  type RegisteredCenterViewKind,
} from "$lib/app/composition/registries/center-view-registry";
import { tabIdentity, tabLabel } from "$lib/app/shell/editor-tab-helpers";
import { workspaceSelectors } from "$lib/application/workspace";
import type { MobileCenterIdentity } from "./mobile-routes";
import { backFromMobileScreen } from "./mobile-shell.svelte";

/**
 * Files, diffs, pull requests and the like as phone screens.
 * Their registered hosts read the active center tab rather than props, so the
 * host renders only while this route is on top and route activation has made
 * its identity the active one.
 */
let {
  identity,
  visible,
}: { identity: MobileCenterIdentity; visible: boolean } = $props();

const tabModel = $derived(
  workspaceSelectors.centerTabs.find((candidate) => {
    const candidateIdentity = tabIdentity(candidate);
    return (
      candidateIdentity.kind === identity.kind &&
      candidateIdentity.id === identity.id
    );
  }),
);
const title = $derived(tabModel ? tabLabel(tabModel) : "Loading…");
const project = $derived(workspaceSelectors.activeProject?.name);
const isActive = $derived(
  workspaceSelectors.activeCenterTab?.kind === identity.kind &&
    workspaceSelectors.activeCenterTab.id === identity.id,
);
const loader = $derived(
  identity.kind in centerViewLoaders
    ? centerViewLoaders[identity.kind as RegisteredCenterViewKind]
    : undefined,
);
</script>

<MobileScreen
  {title}
  subtitle={project}
  onBack={backFromMobileScreen}
  backLabel="Back"
  scroll={false}
>
  {#if visible && isActive && loader}
    {#await loader()}
      <LazyViewPending />
    {:then module}
      {@const Host = module.default as Component}
      <div class="size-full min-h-0 min-w-0"><Host /></div>
    {/await}
  {:else if visible}
    <LazyViewPending />
  {/if}
</MobileScreen>
