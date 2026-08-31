<script lang="ts">
import type { Settings, StatusResponse } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import type { SettingsChange } from "../settings-change";

type Props = {
  open?: boolean;
  settingsDraft: Settings;
  python?: StatusResponse["runtime"]["python"];
  onSettingsChange?: SettingsChange;
};

let {
  open = $bindable(false),
  settingsDraft,
  python,
  onSettingsChange,
}: Props = $props();

let pathDraft = $state("");
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    pathDraft = settingsDraft.runtime?.pythonExecutablePath ?? "";
  }
  lastOpen = open;
});

function savePath(): void {
  const next = pathDraft.trim().length > 0 ? pathDraft : undefined;
  settingsDraft.runtime ??= {};
  settingsDraft.runtime.pythonExecutablePath = next;
  onSettingsChange?.(
    { runtime: { pythonExecutablePath: next ?? null } },
    { immediate: true },
  );
  open = false;
}

function resetPath(): void {
  pathDraft = "";
  settingsDraft.runtime ??= {};
  settingsDraft.runtime.pythonExecutablePath = undefined;
  onSettingsChange?.(
    { runtime: { pythonExecutablePath: null } },
    { immediate: true },
  );
  open = false;
}
</script>

<Dialog
  bind:open
  size="sm"
  title="Configure Python runtime"
  description="Set a manual Python executable path, or leave it empty to auto-detect from the project and system PATH."
>
  <div class="grid gap-3">
    <div class="grid gap-1.5">
      <Label
        for="tools-python-executable"
        class="text-xs font-medium text-muted-foreground"
        >Python executable</Label
      >
      <Input
        size="xs"
        id="tools-python-executable"
        bind:value={pathDraft}
        placeholder="Auto-detect"
        ariaLabel="Python executable path"
      />
    </div>
    {#if python?.executable}
      <p class="text-xs text-muted-foreground">
        Current executable: <span class="font-mono">{python.executable}</span>
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button size="sm" variant="outline" onclick={resetPath}
      >Use auto-detect</Button
    >
    <Button size="sm" onclick={savePath}>Save</Button>
  {/snippet}
</Dialog>
