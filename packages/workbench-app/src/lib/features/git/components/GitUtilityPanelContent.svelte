<script lang="ts">
import type { AgentRecord, ProjectRecord } from "$lib/api";
import { createWorkbenchGitPanelAdapter } from "$lib/features/git/state/workbench-git-panel-adapter.svelte";
import {
  GitUtilityPanelView,
  type GitPanelSectionState,
} from "@nervekit/workbench-ui";
import { utilitySectionPreferences } from "$lib/app/layout/utility-section-preferences.svelte";

type Props = {
  activeProject?: ProjectRecord;
  activeAgent?: AgentRecord;
};

let { activeProject }: Props = $props();
const adapter = createWorkbenchGitPanelAdapter(() => activeProject);
const sectionState = $derived<GitPanelSectionState>({
  repository: utilitySectionPreferences.isOpen("git.repository"),
  changes: utilitySectionPreferences.isOpen("git.changes"),
  pullRequests: utilitySectionPreferences.isOpen("git.pullRequests"),
});
</script>

<GitUtilityPanelView
  model={adapter.model}
  actions={adapter.actions}
  {sectionState}
  onSectionOpenChange={(section, open) =>
    utilitySectionPreferences.setOpen(`git.${section}`, open)}
/>
