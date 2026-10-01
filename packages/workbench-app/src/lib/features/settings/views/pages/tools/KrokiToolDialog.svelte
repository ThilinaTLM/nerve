<script lang="ts">
import {
  defaultKrokiToolSettings,
  krokiToolSettingsSchema,
} from "@nervekit/contracts/settings";
import type { Settings } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import type { SettingsChange } from "../settings-change";

let {
  open = $bindable(false),
  settingsDraft,
  onSettingsChange,
}: {
  open?: boolean;
  settingsDraft: Settings;
  onSettingsChange?: SettingsChange;
} = $props();
let urlDraft = $state("");
let lastOpen = false;
$effect(() => {
  if (open && !lastOpen) urlDraft = settingsDraft.tools.kroki.url;
  lastOpen = open;
});
const parsed = $derived(krokiToolSettingsSchema.safeParse({ url: urlDraft }));
function save(): void {
  if (!parsed.success) return;
  const kroki = parsed.data;
  settingsDraft.tools.kroki = kroki;
  onSettingsChange?.({ tools: { kroki } }, { immediate: true });
  open = false;
}
</script>

<Dialog
  bind:open
  size="sm"
  title="Configure diagram export"
  description="Choose the Kroki server used to export SVG and PNG diagrams."
>
  <div class="grid gap-4">
    <div class="grid gap-1.5">
      <Label for="tools-kroki-url">Kroki URL</Label>
      <Input
        id="tools-kroki-url"
        size="xs"
        bind:value={urlDraft}
        aria-invalid={parsed.success ? undefined : "true"}
        placeholder={defaultKrokiToolSettings.url}
      />
      {#if !parsed.success}
        <p class="text-xs text-destructive">
          Enter an HTTP(S) URL without credentials, query parameters, or
          fragments.
        </p>
      {/if}
    </div>
    <p class="text-xs text-muted-foreground">
      Diagram source is sent to this server when the tool is used. Use a trusted
      self-hosted server for private diagrams. Saving this URL does not enable
      the tool.
    </p>
  </div>
  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => (open = false)}
      >Cancel</Button
    >
    <Button size="sm" disabled={!parsed.success} onclick={save}>Save</Button>
  {/snippet}
</Dialog>
