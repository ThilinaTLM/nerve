<script lang="ts">
import type { Settings } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { SettingsChange } from "../settings-change";

type Props = {
  settingsDraft: Settings;
  onSettingsChange?: SettingsChange;
};

let { settingsDraft, onSettingsChange }: Props = $props();

function clearScope(): void {
  settingsDraft.scopedModels = [];
  onSettingsChange?.({ scopedModels: [] }, { immediate: true });
}
</script>

{#if settingsDraft.scopedModels.length > 0}
  <Button variant="ghost" size="sm" onclick={clearScope}>Clear scope</Button>
{/if}
