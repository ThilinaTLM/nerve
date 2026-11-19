<script lang="ts">
import { Button, host } from "@nervekit/extension-sdk/ui";

let project = $state<{ name: string; directory: string } | undefined>();
let path = $state("README.md");

$effect(() => {
  void host.project.info().then((info) => (project = info));
});

async function remember() {
  await host.viewState.set({ path });
}
</script>

<main class="flex h-screen flex-col gap-3 bg-background p-4 text-foreground">
  <h1 class="text-title font-medium">{project?.name ?? "…"}</h1>
  <p class="text-ui text-muted-foreground">{project?.directory}</p>
  <div class="flex items-center gap-2">
    <input
      class="h-control rounded-md border border-input bg-input-background px-2 text-ui"
      bind:value={path}
      onchange={remember}
    />
    <Button onclick={() => host.openFile(path)}>Open file</Button>
    <Button
      variant="outline"
      onclick={() => host.ui.notify("Hello from __ID__", "success")}
    >
      Notify
    </Button>
  </div>
</main>
