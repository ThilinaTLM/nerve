<script lang="ts">
import { untrack } from "svelte";
import {
  MobileListRow,
  MobileScreen,
  MobileSection,
} from "$lib/presentation/shell";
import {
  settingsNavFor,
  settingsPageFor,
} from "$lib/features/settings/registry/settings-pages";
import { projectSettingsScope } from "$lib/features/settings/registry/settings-scope";
import { loadSettingsPanel } from "$lib/application/settings/settings-actions.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { tildePath } from "$lib/domain/filesystem/project-path";
import {
  backFromMobileScreen,
  pushMobileScreen,
} from "$lib/app/shell/mobile/mobile-shell.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";

/** Project settings index; the route carries the project, so it never drifts. */
let { route }: MobileScreenProps<"project-settings"> = $props();

const project = $derived(
  workspaceSelectors.projects.find(
    (candidate) => candidate.id === route.projectId,
  ),
);
const target = $derived(projectSettingsScope(route.projectId));
const groups = $derived(settingsNavFor(target));
const homeDir = $derived(workspaceSelectors.status?.storage.userHome);

$effect(() => {
  untrack(() => void loadSettingsPanel());
});
</script>

<MobileScreen
  title="Project settings"
  subtitle={project
    ? `${project.name} · ${tildePath(project.directory, homeDir)}`
    : undefined}
  onBack={backFromMobileScreen}
  backLabel="Back to project"
>
  {#each groups as group (group.id)}
    <MobileSection title={group.title}>
      {#each group.items as item (item.id)}
        <MobileListRow
          title={item.label}
          detail={settingsPageFor(target, item.id).description}
          icon={item.icon}
          onclick={() =>
            pushMobileScreen({
              kind: "project-settings-page",
              projectId: route.projectId,
              pageId: item.id,
            })}
        />
      {/each}
    </MobileSection>
  {/each}
</MobileScreen>
