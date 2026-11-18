<script lang="ts">
import Puzzle from "@lucide/svelte/icons/puzzle";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import ExtensionFrame from "./ExtensionFrame.svelte";
import {
  contributionsOf,
  findExtensionPage,
} from "../state/extension-ui.svelte";
import { openExtensionPage } from "../state/page-tabs.svelte";
import { parseExtensionPageTabId } from "../model/page-tab-id";

const tab = $derived(
  workspaceState.activeCenterTab?.kind === "extension-page"
    ? workspaceState.activeCenterTab
    : undefined,
);
const projectId = $derived(workspaceState.selectedProjectId);
const ref = $derived(tab ? parseExtensionPageTabId(tab.id) : undefined);
const contributions = $derived(contributionsOf(projectId));
const page = $derived(
  ref ? findExtensionPage(projectId, ref.extensionId, ref.pageId) : undefined,
);
</script>

{#if tab && ref && projectId && page && contributions}
  <ExtensionFrame
    {projectId}
    extensionId={page.extensionId}
    extensionName={page.extensionName}
    contribution={{ kind: "page", id: page.id }}
    frameUrl={page.frameUrl}
    baseCssUrl={contributions.baseCssUrl}
    title={page.label}
    instance={tab.id}
    pageParams={ref.params}
    onOpenPage={(id, params) =>
      openExtensionPage(projectId, page.extensionId, id, params)}
  />
{:else}
  <div
    class="grid h-full place-content-center justify-items-center gap-1.5 p-4 text-center text-muted-foreground"
  >
    <Puzzle class="size-7 text-primary" strokeWidth={1.7} />
    <strong class="font-medium text-foreground">Page unavailable</strong>
    <p class="m-0 max-w-xl text-ui">
      {contributions
        ? "This page is not offered by an enabled extension in this project."
        : "Loading extension pages."}
    </p>
  </div>
{/if}
