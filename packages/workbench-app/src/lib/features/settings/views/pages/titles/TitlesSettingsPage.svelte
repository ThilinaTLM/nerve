<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import type { AuthProviderMetadata, ModelInfo, Settings } from "$lib/api";
import type {
  ConversationTitlesSettings,
  TitleTestResult,
} from "@nervekit/contracts/settings";
import { TITLE_TEST_PROMPT } from "@nervekit/contracts/settings";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { openSettingsPane } from "$lib/application/settings";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import ModelPicker from "$lib/presentation/model-picker/ModelPicker.svelte";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import {
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import type { SettingsChange } from "../settings-change";
import { isTitleModelCompatible, titleSettingsStatus } from "./title-settings";
let {
  settingsDraft,
  onSettingsChange,
  models = [],
  authProviders = [],
}: {
  settingsDraft: Settings;
  onSettingsChange?: SettingsChange;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
} = $props();
const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders).filter(
    isTitleModelCompatible,
  ),
);
const status = $derived(
  titleSettingsStatus(settingsDraft.conversationTitles, usableModels),
);
let running = $state(false);
let result = $state<TitleTestResult>();
function save(patch: Partial<ConversationTitlesSettings>) {
  settingsDraft.conversationTitles = {
    ...settingsDraft.conversationTitles,
    ...patch,
  };
  result = undefined;
  onSettingsChange?.(
    { conversationTitles: settingsDraft.conversationTitles },
    { immediate: true },
  );
}
async function runTest() {
  running = true;
  result = undefined;
  try {
    result = await requestWorkbench("conversationTitles.test", {});
  } catch {
    result = { category: "unavailable" };
  } finally {
    running = false;
  }
}
</script>

<SettingsSection
  id="ai-titles"
  title="AI titles"
  info="New conversations always get an instant local title first. An AI title replaces it in the background, once, and never overrides a name you set."
>
  <Callout layout="block" tone="brand">
    Sends a shortened version of each new conversation's first prompt to the
    selected provider, which may bill for usage. It can differ from your coding
    agent's provider.
  </Callout>
  <SettingsToggleRow
    label="Improve titles with AI"
    description="Off by default. Existing conversations are never retitled."
    checked={settingsDraft.conversationTitles.enabled}
    onCheckedChange={(enabled) => save({ enabled })}
  />
  <SettingsRow
    label="Model"
    description="A small, fast text model works best, such as Flash-Lite, GPT-5 nano or Haiku."
    layout="responsive"
  >
    {#snippet hint()}
      <button
        type="button"
        class="inline-flex items-center gap-0.5 text-primary hover:underline"
        onclick={() => void openSettingsPane("providers")}
        >Providers<ArrowRight class="size-3" aria-hidden="true" /></button
      >
    {/snippet}
    {#snippet control()}
      <ModelPicker
        label="Title model"
        class="w-full"
        models={usableModels}
        value={settingsDraft.conversationTitles.model ?? undefined}
        thinkingLevel="off"
        showReasoning={false}
        disabled={status === "off"}
        isModelCompatible={isTitleModelCompatible}
        onChange={({ model }) => save({ model: model ?? null })}
      />
    {/snippet}
  </SettingsRow>
  {#if status === "no-model"}
    <Callout layout="block" tone="warning"
      >Choose a model to start. Until then, local titles are used.</Callout
    >
  {:else if status === "unavailable"}
    <Callout layout="block" tone="warning"
      >This model isn't available with your connected providers. Local titles
      are used until you choose another model or reconnect its provider.</Callout
    >
  {/if}
</SettingsSection>
<SettingsSection
  id="test"
  title="Test"
  info="Uses a built-in sample prompt, never one of your conversations."
>
  <SettingsRow label="Sample prompt" description={TITLE_TEST_PROMPT}>
    {#snippet control()}
      <Button
        variant="outline"
        disabled={status !== "ready" || running}
        onclick={runTest}
        >{#if running}<Spinner />{/if}Run test</Button
      >
    {/snippet}
  </SettingsRow>
  {#if result}
    <Callout
      layout="block"
      tone={result.category === "success" ? "success" : "destructive"}
    >
      {result.category === "success"
        ? `${result.title} · ${result.latencyMs} ms`
        : result.category}
    </Callout>
  {/if}
</SettingsSection>
