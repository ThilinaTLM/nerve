<script lang="ts">
import type { GitPanelActions, GitPanelModel } from "$lib/features/git";
import LazyViewPending from "$lib/app/shell/LazyViewPending.svelte";
import {
  panelViewDescriptors,
  type LoadedWorkbenchPanel,
} from "$lib/app/composition/registries/panel-registry";

let {
  viewId,
  gitModel,
  gitActions,
}: {
  viewId: string;
  gitModel: GitPanelModel;
  gitActions: GitPanelActions;
} = $props();

// Keep this cache non-reactive: it is populated inside `$derived.by`, where
// mutating reactive state would trigger `state_unsafe_mutation`.
const moduleCache = Object.create(null) as Record<
  string,
  Promise<LoadedWorkbenchPanel>
>;
const descriptor = $derived(
  panelViewDescriptors.find((candidate) => candidate.id === viewId),
);
const panelModule = $derived.by(() => {
  if (!descriptor) return undefined;
  let loaded = moduleCache[descriptor.id];
  if (!loaded) {
    loaded =
      descriptor.propsKind === "git"
        ? descriptor.load().then(
            ({ default: component }): LoadedWorkbenchPanel => ({
              propsKind: "git",
              component,
            }),
          )
        : descriptor.load().then(
            ({ default: component }): LoadedWorkbenchPanel => ({
              propsKind: "none",
              component,
            }),
          );
    moduleCache[descriptor.id] = loaded;
  }
  return loaded;
});
</script>

{#if panelModule}
  {#await panelModule}
    <LazyViewPending />
  {:then module}
    {#if module.propsKind === "git"}
      {@const Panel = module.component}
      <Panel {gitModel} {gitActions} />
    {:else}
      {@const Panel = module.component}
      <Panel />
    {/if}
  {/await}
{/if}
