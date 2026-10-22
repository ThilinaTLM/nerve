<script lang="ts">
import { projectSettingsScope } from "$lib/features/settings/registry/settings-scope";
import { workspaceSelectors } from "$lib/application/workspace";
import MobileSettingsPageScreen from "./MobileSettingsPageScreen.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";

let { route }: MobileScreenProps<"project-settings-page"> = $props();

const project = $derived(
  workspaceSelectors.projects.find(
    (candidate) => candidate.id === route.projectId,
  ),
);
const target = $derived(projectSettingsScope(route.projectId));
</script>

<MobileSettingsPageScreen
  {target}
  {project}
  pageId={route.pageId}
  backLabel="Back to project settings"
/>
