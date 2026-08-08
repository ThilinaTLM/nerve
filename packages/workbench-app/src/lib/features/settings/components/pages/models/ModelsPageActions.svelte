<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import type { AuthProviderMetadata, ModelInfo, Settings } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import type { SettingsChange } from "../settings-change";
import type { ModelsPageState } from "./models-page-state.svelte";

type Props = {
  pageState: ModelsPageState;
  settingsDraft: Settings;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};

let {
  pageState,
  settingsDraft,
  models = [],
  authProviders = [],
  onSettingsChange,
}: Props = $props();

const availableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const scopeActive = $derived(settingsDraft.scopedModels.length > 0);

function clearScope(): void {
  settingsDraft.scopedModels = [];
  onSettingsChange?.({ scopedModels: [] }, { immediate: true });
}
</script>

{#if scopeActive}
  <Button variant="ghost" size="sm" onclick={clearScope}>Clear</Button>
{/if}
<Button
  size="sm"
  disabled={availableModels.length === 0}
  data-tour-id="setup-scoped-models-add"
  onclick={() => (pageState.addDialogOpen = true)}
>
  <Plus class="size-3.5" aria-hidden="true" />
  Add models
</Button>
