<script lang="ts">
import { onDestroy } from "svelte";
import { SettingsInlineMessage } from "$lib/presentation/settings";
import Check from "@lucide/svelte/icons/check";
import Copy from "@lucide/svelte/icons/copy";
import ExternalLink from "@lucide/svelte/icons/external-link";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { AuthProviderMetadata } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { AddProviderFlow } from "./add-provider-flow.svelte";
import {
  isProviderAvailableForDialog,
  type ProviderDialogKind,
} from "./provider-auth-routing";

type Props = {
  open?: boolean;
  authProviders?: AuthProviderMetadata[];
  kind?: ProviderDialogKind;
  excludeProviders?: string[];
};

let {
  open = $bindable(false),
  authProviders = [],
  kind = "all",
  excludeProviders = [],
}: Props = $props();

const flowController = new AddProviderFlow(() => (open = false));
const excluded = $derived(new Set(excludeProviders));
const available = $derived(
  [...authProviders]
    .filter(
      (provider) =>
        isProviderAvailableForDialog(provider, kind) &&
        !excluded.has(provider.provider) &&
        !provider.provider.startsWith("atlassian:") &&
        !provider.provider.startsWith("tavily:"),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName)),
);
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
      <SettingsInlineMessage
        tone="warning"
        text={flowController.selected.warning}
      />
    {/if}
    {#if flowController.step === "choose"}
      {#if available.length === 0}
        <p class="text-sm text-muted-foreground">
          All known providers are already connected.
        </p>
      {:else}
        <Tooltip.Provider delayDuration={200} disableHoverableContent>
          <ul
            class="grid h-[min(52vh,24rem)] content-start gap-1 overflow-y-auto pr-1"
            data-tour-id="setup-auth-provider-choices"
          >
            {#each available as provider (provider.provider)}
              <li class="flex items-center gap-1">
                <button
                  type="button"
                  class="flex min-w-0 flex-1 cursor-pointer items-center rounded-md border border-transparent bg-card px-2 py-2 text-left transition-colors hover:bg-accent/50"
                  data-tour-id={provider.provider === "openai-codex"
                    ? "setup-auth-openai-codex-choice"
                    : undefined}
                  onclick={() => flowController.chooseProvider(provider, kind)}
                >
                  <span
                    class="flex min-w-0 flex-1 items-baseline gap-2 text-sm"
                  >
                    <span class="truncate">{provider.displayName}</span>
                    <span
                      class="truncate font-mono text-xs text-muted-foreground"
                      >{provider.provider}</span
                    >
                  </span>
                </button>
                {#if kind !== "api_key" && provider.supportsOAuth && provider.warning}
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <span
                          {...props}
                          role="img"
                          class="inline-flex shrink-0 cursor-help px-1 text-warning"
                          aria-label={provider.warning}
                        >
                          <TriangleAlert class="size-4" />
                        </span>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content sideOffset={5} class="max-w-64"
                      >{provider.warning}</Tooltip.Content
                    >
                  </Tooltip.Root>
                {/if}
              </li>
            {/each}
          </ul>
        </Tooltip.Provider>
      {/if}
    {:else if flowController.step === "method"}
      <div class="grid gap-2">
        <Button
          variant="outline"
          onclick={() => flowController.chooseMethod("oauth")}
        >
          <span class="grid text-left">
            <span>Connect subscription</span>
            <span class="text-xs font-normal text-muted-foreground">
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
            <span class="text-xs font-normal text-muted-foreground">
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
          <p class="text-xs text-warning">
            Saving an API key will replace the connected subscription for this
            provider.
          </p>
        {/if}
        <label
          class="flex items-center justify-between gap-2 text-sm font-medium"
          for="add-provider-api-key"
        >
          API key
          {#if flowController.selected?.envVar}
            <span class="font-mono text-xs font-normal text-muted-foreground"
              >{flowController.selected.envVar}</span
            >
          {/if}
        </label>
        <Input
          size="xs"
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
          <p class="text-xs text-warning">
            Connecting the subscription will replace the API key for this
            provider.
          </p>
        {/if}
        {#if flowController.flow?.state === "active"}
          {@const interaction = flowController.flow.interaction}
          {#if interaction.type === "starting"}
            <p class="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Starting login…
            </p>
          {:else if interaction.type === "choice"}
            <p class="text-sm text-foreground">{interaction.message}</p>
            <div class="grid gap-2">
              {#each interaction.options as option (option.id)}
                <Button
                  variant="outline"
                  disabled={flowController.busy}
                  onclick={() => void flowController.selectOption(option.id)}
                >
                  <span class="grid text-left">
                    <span>{option.label}</span>
                    {#if option.description}<span
                        class="text-xs font-normal text-muted-foreground"
                        >{option.description}</span
                      >{/if}
                  </span>
                </Button>
              {/each}
            </div>
          {:else if interaction.type === "browser"}
            <div class="grid gap-2 sm:grid-cols-2">
              <Button
                variant="outline"
                onclick={() =>
                  flowController.openExternal(interaction.authorizationUrl)}
              >
                <ExternalLink size={15} strokeWidth={2} /> Open login page
              </Button>
              <Button
                variant="outline"
                onclick={() => void flowController.copyLoginUrl()}
              >
                {#if flowController.copiedLoginUrl}
                  <Check size={15} strokeWidth={2} /> Copied login URL
                {:else}
                  <Copy size={15} strokeWidth={2} /> Copy login URL
                {/if}
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">
              {interaction.instructions}
            </p>
            {#if interaction.manualEntry}
              <form
                class="grid gap-2"
                onsubmit={(event) => {
                  event.preventDefault();
                  void flowController.submitResponse();
                }}
              >
                <label class="text-sm font-medium" for="oauth-manual-redirect"
                  >{interaction.manualEntry.label}</label
                >
                <Input
                  size="xs"
                  id="oauth-manual-redirect"
                  type="text"
                  autocomplete="off"
                  placeholder={interaction.manualEntry.placeholder}
                  bind:value={flowController.responseValue}
                  disabled={flowController.busy}
                />
              </form>
            {/if}
          {:else if interaction.type === "device_code"}
            <Button
              variant="outline"
              onclick={() =>
                flowController.openExternal(interaction.verificationUrl)}
            >
              <ExternalLink size={15} strokeWidth={2} /> Open verification page
            </Button>
            <div class="grid justify-items-start gap-2">
              <p class="text-xs text-muted-foreground">Enter this code:</p>
              <Button
                variant="outline"
                onclick={() => void flowController.copyDeviceCode()}
                aria-label="Copy device code"
              >
                <code class="font-mono text-base tracking-widest"
                  >{interaction.userCode}</code
                >
                {#if flowController.copiedDeviceCode}<Check
                    size={15}
                    strokeWidth={2}
                  />{:else}<Copy size={15} strokeWidth={2} />{/if}
              </Button>
              {#if flowController.deviceCodeSecondsRemaining !== undefined}
                <p class="text-xs text-muted-foreground">
                  {flowController.deviceCodeSecondsRemaining === 0
                    ? "Code expired. Waiting for the provider…"
                    : `Expires in ${flowController.deviceCodeSecondsRemaining}s`}
                </p>
              {/if}
            </div>
          {:else if interaction.type === "text_input"}
            <p class="text-sm text-foreground">{interaction.message}</p>
            <form
              class="grid gap-2"
              onsubmit={(event) => {
                event.preventDefault();
                void flowController.submitResponse();
              }}
            >
              <Input
                size="xs"
                type={interaction.inputKind === "secret" ? "password" : "text"}
                autocomplete="off"
                placeholder={interaction.placeholder ?? "Enter a response"}
                bind:value={flowController.responseValue}
                disabled={flowController.busy}
              />
            </form>
          {:else if interaction.type === "progress"}
            <p class="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {interaction.message}
            </p>
            {#if interaction.links?.length}
              <div class="grid gap-2">
                {#each interaction.links as link (link.url)}
                  <Button
                    variant="outline"
                    onclick={() => flowController.openExternal(link.url)}
                  >
                    <ExternalLink size={15} strokeWidth={2} />
                    {link.label ?? "Open link"}
                  </Button>
                {/each}
              </div>
            {/if}
          {/if}
        {:else if flowController.flow?.state === "failed"}
          <p class="text-sm text-destructive">
            {flowController.flow.failure.message}
          </p>
          {#if flowController.flow.failure.detail}<p
              class="text-xs text-muted-foreground"
            >
              {flowController.flow.failure.detail}
            </p>{/if}
          <Button
            variant="outline"
            disabled={flowController.busy}
            onclick={() => void flowController.restartOAuth()}>Try again</Button
          >
        {:else if flowController.flow?.state === "succeeded"}
          <p class="text-sm font-medium text-success">
            {flowController.flow.successMessage}
          </p>
        {:else if flowController.flow?.state === "cancelled"}
          <p class="text-sm text-muted-foreground">Login was cancelled.</p>
          <Button
            variant="outline"
            disabled={flowController.busy}
            onclick={() => void flowController.restartOAuth()}>Try again</Button
          >
        {:else if flowController.busy}
          <p class="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Starting login…
          </p>
        {:else}
          <Button
            variant="outline"
            onclick={() => void flowController.restartOAuth()}>Try again</Button
          >
        {/if}
      </div>
    {/if}

    {#if flowController.error}
      <p class="flex items-center gap-2 text-xs text-destructive">
        <TriangleAlert size={14} strokeWidth={2} />
        {flowController.error}
      </p>
    {/if}
  </div>

  {#snippet footer()}
    {#if flowController.flow?.state === "succeeded"}
      <Button size="sm" onclick={() => void flowController.close()}>Done</Button
      >
    {:else}
      <Button
        size="sm"
        variant="ghost"
        onclick={() => void flowController.close()}>Cancel</Button
      >
      {#if flowController.step === "api-key"}
        <Button
          size="sm"
          onclick={() => void flowController.submitApiKey()}
          disabled={flowController.busy ||
            flowController.apiKey.trim().length === 0}
        >
          {flowController.busy ? "Saving…" : "Save API key"}
        </Button>
      {:else if flowController.step === "oauth" && (activeInteraction?.type === "text_input" || (activeInteraction?.type === "browser" && activeInteraction.manualEntry))}
        <Button
          size="sm"
          onclick={() => void flowController.submitResponse()}
          disabled={responseDisabled}>Submit</Button
        >
      {/if}
    {/if}
  {/snippet}
</Dialog>
