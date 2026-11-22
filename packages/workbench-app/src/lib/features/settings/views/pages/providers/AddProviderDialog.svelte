<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { onDestroy } from "svelte";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import ProviderIcon from "$lib/presentation/model-picker/ProviderIcon.svelte";
import PopoverPanel, {
  PopoverCommandList,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { providerCommandItems } from "./provider-profiles";
import type { AuthProviderMetadata } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import OAuthInteractionPanel from "$lib/presentation/settings/OAuthInteractionPanel.svelte";
import { AddProviderFlow } from "./add-provider-flow.svelte";
import {
  isProviderAvailableForDialog,
  type ProviderDialogKind,
} from "./provider-auth-routing";

type Props = {
  open?: boolean;
  triggerLabel?: string;
  triggerTourId?: string;
  authProviders?: AuthProviderMetadata[];
  kind?: ProviderDialogKind;
  excludeProviders?: string[];
};

let {
  open = $bindable(false),
  triggerLabel,
  triggerTourId,
  authProviders = [],
  kind = "all",
  excludeProviders = [],
}: Props = $props();

let choicesOpen = $state(false);
const flowController = new AddProviderFlow(() => (open = false));
const excluded = $derived(new Set(excludeProviders));
const available = $derived(
  [...authProviders]
    .filter(
      (provider) =>
        isProviderAvailableForDialog(provider, kind) &&
        !excluded.has(provider.provider),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName)),
);
const items = $derived(providerCommandItems(available));
const activeInteraction = $derived(
  flowController.flow?.state === "active"
    ? flowController.flow.interaction
    : undefined,
);
const responseDisabled = $derived(
  flowController.busy ||
    (!(
      activeInteraction?.type === "text_input" && activeInteraction.allowEmpty
    ) &&
      flowController.responseValue.trim().length === 0),
);

function handleOpenChange(next: boolean) {
  if (!next) void flowController.close();
}

onDestroy(() => void flowController.dispose());
</script>

{#snippet providerChoices()}
  <Tooltip.Provider delayDuration={200} disableHoverableContent>
    <div data-tour-id="setup-auth-provider-choices">
      <PopoverCommandList
        {items}
        ariaLabel="Providers"
        placeholder="Search providers…"
        stableHeight="calc(var(--spacing) * 64)"
        empty={available.length === 0
          ? "All known providers are already connected."
          : "No matching providers."}
        onChoose={(item) => {
          choicesOpen = false;
          open = true;
          flowController.chooseProvider(item.provider, kind);
        }}
      >
        {#snippet icon(item)}
          <ProviderIcon provider={item.key} class="size-4" />
        {/snippet}
        {#snippet row(item)}
          <span
            class="flex min-w-0 flex-1 items-center gap-2"
            data-tour-id={item.key === "openai-codex"
              ? "setup-auth-openai-codex-choice"
              : undefined}
          >
            <span class="truncate">{item.label}</span>
            <span class="truncate text-muted-foreground">{item.detail}</span>
            {#if kind !== "api_key" && item.provider.supportsOAuth && item.provider.warning}
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <span
                      {...props}
                      role="img"
                      class="ml-auto shrink-0 text-warning"
                      aria-label={item.provider.warning}
                    >
                      <TriangleAlert class="size-3.5" />
                    </span>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content class="max-w-64"
                  >{item.provider.warning}</Tooltip.Content
                >
              </Tooltip.Root>
            {/if}
          </span>
        {/snippet}
      </PopoverCommandList>
    </div>
  </Tooltip.Provider>
{/snippet}

{#if triggerLabel}
  <PopoverPanel
    bind:open={choicesOpen}
    variant="panel"
    size="lg"
    ariaLabel={triggerLabel}
  >
    {#snippet triggerChild({ props })}
      <Button
        {...props}
        variant="outline"
        size="sm"
        data-tour-id={triggerTourId}>{triggerLabel}</Button
      >
    {/snippet}
    {#if choicesOpen}{@render providerChoices()}{/if}
  </PopoverPanel>
{/if}

<Dialog
  bind:open
  title={flowController.step === "choose"
    ? kind === "oauth"
      ? "Connect subscription"
      : kind === "api_key"
        ? "Add API key"
        : flowController.dialogTitle
    : flowController.dialogTitle}
  description={flowController.step === "choose"
    ? kind === "oauth"
      ? "Choose a provider to connect with your subscription."
      : kind === "api_key"
        ? "Choose a provider for your API key."
        : flowController.dialogDescription
    : flowController.dialogDescription}
  size="sm"
  closeOnInteractOutside={false}
  onOpenChange={handleOpenChange}
>
  <div class="grid gap-4">
    {#if (flowController.step === "method" || flowController.step === "oauth") && flowController.selected?.warning}
      <Callout
        layout="block"
        tone="warning"
        text={flowController.selected.warning}
      />
    {/if}
    {#if flowController.step === "choose"}
      {@render providerChoices()}
    {:else if flowController.step === "method"}
      <div class="grid gap-2">
        <Button
          variant="outline"
          onclick={() => flowController.chooseMethod("oauth")}
        >
          <span class="grid text-left">
            <span>Connect subscription</span>
            <span class="text-ui text-muted-foreground">
              Sign in with an account plan supported by this provider.
            </span>
          </span>
        </Button>
        <Button
          variant="outline"
          onclick={() => flowController.chooseMethod("api-key")}
        >
          <span class="grid text-left">
            <span>Use API key</span>
            <span class="text-ui text-muted-foreground">
              Authenticate with developer API billing.
            </span>
          </span>
        </Button>
      </div>
    {:else if flowController.step === "api-key"}
      <form
        class="grid gap-2"
        onsubmit={(event) => {
          event.preventDefault();
          void flowController.submitApiKey();
        }}
      >
        {#if flowController.selected?.credentialType === "oauth"}
          <p class="text-ui text-warning">
            Saving an API key will replace the connected subscription for this
            provider.
          </p>
        {/if}
        <label
          class="flex items-center justify-between gap-2 text-ui"
          for="add-provider-api-key"
        >
          API key
          {#if flowController.selected?.envVar}
            <span class="font-mono text-ui text-muted-foreground"
              >{flowController.selected.envVar}</span
            >
          {/if}
        </label>
        <Input
          id="add-provider-api-key"
          type="password"
          autocomplete="off"
          placeholder="Paste your API key"
          bind:value={flowController.apiKey}
          disabled={flowController.busy}
        />
      </form>
    {:else if flowController.step === "oauth"}
      <div class="grid gap-3" aria-live="polite">
        {#if flowController.selected?.credentialType === "api_key"}
          <p class="text-ui text-warning">
            Connecting the subscription will replace the API key for this
            provider.
          </p>
        {/if}
        <OAuthInteractionPanel
          flow={flowController.flow}
          busy={flowController.busy}
          bind:responseValue={flowController.responseValue}
          copiedLoginUrl={flowController.copiedLoginUrl}
          copiedDeviceCode={flowController.copiedDeviceCode}
          deviceCodeSecondsRemaining={flowController.deviceCodeSecondsRemaining}
          onSelect={(id) => void flowController.selectOption(id)}
          onSubmit={() => void flowController.submitResponse()}
          onCopyLoginUrl={() => void flowController.copyLoginUrl()}
          onCopyDeviceCode={() => void flowController.copyDeviceCode()}
          onOpen={(url) => flowController.openExternal(url)}
          onRetry={() => void flowController.restart()}
        />
      </div>
    {/if}

    {#if flowController.error}
      <p class="flex items-center gap-2 text-ui text-destructive">
        <TriangleAlert size={14} strokeWidth={2} />
        {flowController.error}
      </p>
    {/if}
  </div>

  {#snippet footer()}
    {#if flowController.flow?.state === "succeeded"}
      <Button onclick={() => void flowController.close()}>Done</Button>
    {:else}
      <Button variant="ghost" onclick={() => void flowController.close()}
        >Cancel</Button
      >
      {#if flowController.step === "api-key"}
        <Button
          onclick={() => void flowController.submitApiKey()}
          disabled={flowController.busy ||
            flowController.apiKey.trim().length === 0}
        >
          {flowController.busy ? "Saving…" : "Save API key"}
        </Button>
      {:else if flowController.step === "oauth" && (activeInteraction?.type === "text_input" || (activeInteraction?.type === "browser" && activeInteraction.manualEntry))}
        <Button
          onclick={() => void flowController.submitResponse()}
          disabled={responseDisabled}>Submit</Button
        >
      {/if}
    {/if}
  {/snippet}
</Dialog>
