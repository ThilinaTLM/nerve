<script lang="ts">
import { openSettingsPane } from "$lib/application/settings";
import { workspaceSelectors } from "$lib/application/workspace";
import DiscoverView from "$lib/app/onboarding/components/DiscoverView.svelte";
import {
  discoverSections,
  markDiscoverSeen,
} from "$lib/app/onboarding/discover-state.svelte";
import {
  markGuideCompleted,
  startGuide,
} from "$lib/app/onboarding/guide-state.svelte";
import type { DiscoverEditorialAction } from "$lib/app/onboarding/discover-catalog";

const sections = $derived(discoverSections());
$effect(() => {
  markDiscoverSeen();
});

function handleEditorialAction(action: DiscoverEditorialAction): void {
  if (action.kind === "guide") {
    startGuide(action.guideId);
    return;
  }
  void openSettingsPane(action.pageId, action.sectionId);
}
</script>

<DiscoverView
  {sections}
  workbenchBlocked={!workspaceSelectors.activeProject}
  onStartGuide={startGuide}
  onMarkCompleted={markGuideCompleted}
  onEditorialAction={handleEditorialAction}
/>
