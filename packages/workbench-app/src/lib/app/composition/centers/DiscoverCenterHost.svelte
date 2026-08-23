<script lang="ts">
import { openSettingsPane } from "$lib/application/settings";
import { workspaceSelectors } from "$lib/application/workspace";
import {
  DiscoverView,
  discoverSections,
  markDiscoverSeen,
  type DiscoverEditorialAction,
} from "$lib/app/discover";
import { markGuideCompleted, startGuide } from "$lib/app/discover/guides";

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
