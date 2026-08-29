<script lang="ts">
import type { GitPanelActions, GitPanelModel } from "$lib/features/git";
import { SvelteMap } from "svelte/reactivity";
import LazyViewPending from "$lib/app/shell/LazyViewPending.svelte";
import {
  panelViewDescriptors,
  type WorkbenchPanelDescriptor,
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

const moduleCache = new SvelteMap<
  string,
  ReturnType<WorkbenchPanelDescriptor["load"]>
>();
const descriptor = $derived(
  panelViewDescriptors.find((candidate) => candidate.id === viewId),
);
const panelModule = $derived.by(() => {
  if (!descriptor) return undefined;
  let loaded = moduleCache.get(descriptor.id);
  if (!loaded) {
    loaded = descriptor.load();
    moduleCache.set(descriptor.id, loaded);
  }
  return loaded;
});
</script>

{#if panelModule}
  {#await panelModule}
    <LazyViewPending />
  {:then module}
    {@const Panel = module.default}
    <Panel {gitModel} {gitActions} />
  {/await}
{/if}
