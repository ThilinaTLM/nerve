<script lang="ts">
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { PanelEmpty, PanelHeader, PanelView } from "$lib/presentation/panels";
import ExtensionFrame from "./ExtensionFrame.svelte";
import { contributionsOf } from "../state/extension-ui.svelte";
import { openExtensionPage } from "../state/page-tabs.svelte";
import { parseExtensionPanelViewId } from "../model/page-tab-id";

let { viewId }: { viewId: string } = $props();

const projectId = $derived(workspaceState.selectedProjectId);
const ref = $derived(parseExtensionPanelViewId(viewId));
const contributions = $derived(contributionsOf(projectId));
const panel = $derived(
  ref
    ? contributions?.panels.find(
        (candidate) =>
          candidate.extensionId === ref.extensionId &&
          candidate.id === ref.panelId,
      )
    : undefined,
);
</script>

<PanelView>
  {#snippet banner()}
    <PanelHeader title={panel?.label ?? "Extension"} />
  {/snippet}
  {#if panel && contributions && projectId}
    <!-- Docks render only the active view, so a hidden panel's frame is unloaded; the frame
         restores through its view state. -->
    <ExtensionFrame
      {projectId}
      extensionId={panel.extensionId}
      extensionName={panel.extensionName}
      contribution={{ kind: "panel", id: panel.id }}
      frameUrl={panel.frameUrl}
      baseCssUrl={contributions.baseCssUrl}
      title={panel.label}
      instance={viewId}
      onOpenPage={(id, params) =>
        openExtensionPage(projectId, panel.extensionId, id, params)}
    />
  {:else}
    <PanelEmpty
      title="Panel unavailable"
      description="Open a project with this extension enabled."
    />
  {/if}
</PanelView>
