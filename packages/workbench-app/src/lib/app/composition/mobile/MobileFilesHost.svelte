<script lang="ts">
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { MobileScreen } from "$lib/presentation/shell";
import { fileExplorerState } from "$lib/features/filesystem/state/file-explorer-state.svelte";
import { loadFileExplorerDirectory } from "$lib/features/filesystem/state/file-explorer-actions.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { backFromMobileScreen } from "$lib/app/shell/mobile/mobile-shell.svelte";
import MobileFilesBody from "./MobileFilesBody.svelte";
import type { MobileScreenProps } from "./mobile-screen-registry";

/** One directory per screen; drilling into a folder pushes the next level. */
let { route }: MobileScreenProps<"files"> = $props();

const projectId = $derived(route.projectId);
const path = $derived(route.path);
const project = $derived(
  workspaceSelectors.projects.find((candidate) => candidate.id === projectId),
);
const directory = $derived(
  fileExplorerState.projects[projectId]?.directories[path],
);
const title = $derived(
  path ? (path.split("/").at(-1) ?? path) : (project?.name ?? "Files"),
);
</script>

<MobileScreen
  {title}
  subtitle={path ? `${project?.name ?? ""}/${path}` : "Project root"}
  onBack={backFromMobileScreen}
  backLabel="Back"
>
  {#snippet actions()}
    <Button
      variant="ghost"
      size="icon"
      ariaLabel="Refresh"
      disabled={directory?.loading || directory?.refreshing}
      onclick={() =>
        void loadFileExplorerDirectory(projectId, path, { refresh: true })}
    >
      <RefreshCw size={17} strokeWidth={1.9} />
    </Button>
  {/snippet}

  <MobileFilesBody {projectId} {path} />
</MobileScreen>
