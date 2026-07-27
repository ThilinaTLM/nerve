<script lang="ts">
import type { AgentRecord, ProjectRecord } from "$lib/api";
import { createWorkbenchGitPanelAdapter } from "$lib/features/git/state/workbench-git-panel-adapter.svelte";
import {
  GitPanelView,
  type GitPanelSectionState,
} from "@nervekit/workbench-ui";
import { panelSectionPreferences } from "$lib/app/shell/panel-section-preferences.svelte";

type Props = {
  activeProject?: ProjectRecord;
  activeAgent?: AgentRecord;
};

let { activeProject }: Props = $props();
const adapter = createWorkbenchGitPanelAdapter(() => activeProject);
const sectionState = $derived<GitPanelSectionState>({
  repository: panelSectionPreferences.isOpen("git.repository"),
  changes: panelSectionPreferences.isOpen("git.changes"),
  pullRequests: panelSectionPreferences.isOpen("git.pullRequests"),
});
</script>

<GitPanelView
  model={adapter.model}
  actions={adapter.actions}
  {sectionState}
  onSectionOpenChange={(section, open) =>
    panelSectionPreferences.setOpen(`git.${section}`, open)}
/>
