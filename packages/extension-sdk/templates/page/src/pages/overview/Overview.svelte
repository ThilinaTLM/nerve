<script lang="ts">
import {
  Button,
  FieldRow,
  host,
  Input,
  PageHeader,
  PageSection,
  PageView,
  ToggleRow,
} from "@nervekit/extension-sdk/ui";

let project = $state<{ name: string; directory: string } | undefined>();
let path = $state("README.md");
let notifyOnOpen = $state(false);

$effect(() => {
  void host.project.info().then((info) => (project = info));
  // The host keeps the tab's view state; restore it when the tab opens.
  void host.tabState.get().then((state) => {
    if (!state || typeof state !== "object") return;
    if ("path" in state && typeof state.path === "string") path = state.path;
    if ("notifyOnOpen" in state) notifyOnOpen = state.notifyOnOpen === true;
  });
});

async function remember() {
  await host.tabState.set({ path, notifyOnOpen });
}

async function openFile() {
  await host.workspace.openFile(path);
  if (notifyOnOpen) host.ui.notify(`Opened ${path}`, "success");
}
</script>

<PageView>
  <PageHeader title={project?.name ?? "…"} description={project?.directory} />

  <PageSection
    title="Open a file"
    description="Paths are relative to the project."
    divided
  >
    <FieldRow label="File" htmlFor="overview-path">
      {#snippet control()}
        <div class="flex gap-2">
          <Input
            id="overview-path"
            class="min-w-0 flex-1"
            bind:value={path}
            onchange={remember}
          />
          <Button onclick={openFile}>Open file</Button>
        </div>
      {/snippet}
    </FieldRow>
    <ToggleRow
      label="Notify on open"
      description="Show a toast after the file opens."
      bind:checked={notifyOnOpen}
      onCheckedChange={() => void remember()}
    />
  </PageSection>
</PageView>
