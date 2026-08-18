<script lang="ts">
import { onDestroy } from "svelte";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import ExternalLink from "@lucide/svelte/icons/external-link";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { AuthProviderMetadata } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { AddProviderFlow } from "./add-provider-flow.svelte";

type Props = {
  open?: boolean;
  authProviders?: AuthProviderMetadata[];
  kind?: "oauth" | "api_key" | "all";
  excludeProviders?: string[];
};

let {
  open = $bindable(false),
  authProviders = [],
  kind = "all",
  excludeProviders = [],
}: Props = $props();

const flowController = new AddProviderFlow(() => {
  open = false;
});

const excluded = $derived(new Set(excludeProviders));
const available = $derived(
  [...authProviders]
    .filter((provider) => {
      if (
        provider.configured ||
        excluded.has(provider.provider) ||
        provider.provider.startsWith("atlassian:") ||
        provider.provider.startsWith("tavily:")
      )
        return false;
      if (kind === "oauth") return provider.supportsOAuth;
      if (kind === "api_key")
        return provider.supportsApiKey && !provider.supportsOAuth;
      return provider.supportsOAuth || provider.supportsApiKey;
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName)),
);

function handleOpenChange(next: boolean) {
  if (!next) {
    void flowController.close();
  }
}

// Navigating away (e.g. switching auth tabs) must cancel an in-flight OAuth
// flow and stop its polling timer, not just clicking Close.
onDestroy(() => {
  void flowController.dispose();
});
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
    {#if flowController.step === "choose"}
      {#if available.length === 0}
        <p class="text-sm text-muted-foreground">
          All known providers are already connected.
        </p>
      {:else}
        <ul
          class="grid h-[min(52vh,24rem)] content-start gap-1 overflow-y-auto pr-1"
          data-tour-id="setup-auth-provider-choices"
        >
          {#each available as provider (provider.provider)}
            <li>
              <button
                type="button"
                class="flex w-full cursor-pointer items-center rounded-md border border-transparent bg-accent/90 px-2 py-2 text-left transition-colors hover:bg-accent/95 dark:bg-accent/60 dark:hover:bg-accent/70"
                data-tour-id={provider.provider === "openai-codex"
                  ? "setup-auth-openai-codex-choice"
                  : undefined}
                onclick={() => flowController.chooseProvider(provider)}
              >
                <span class="flex min-w-0 flex-1 items-baseline gap-2 text-sm">
                  <span class="truncate">{provider.displayName}</span>
                  <span class="truncate font-mono text-xs text-muted-foreground"
                    >{provider.provider}</span
                  >
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if flowController.step === "api-key"}
      <form
        class="grid gap-2"
        onsubmit={(event) => {
          event.preventDefault();
          void flowController.submitApiKey();
        }}
      >
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
        {#if flowController.flow}
          {#if flowController.flow.message}
            <p class="text-sm text-foreground">{flowController.flow.message}</p>
          {/if}

          {#if flowController.flow.links?.length}
            <div class="grid gap-2">
              {#each flowController.flow.links as link (link.url)}
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

          {#if flowController.flow.status === "auth_url" && flowController.flow.authUrl}
            <Button
              variant="outline"
              onclick={() =>
                flowController.flow?.authUrl &&
                flowController.openExternal(flowController.flow.authUrl)}
            >
              <ExternalLink size={15} strokeWidth={2} />
              Open login page
            </Button>
            {#if flowController.flow.instructions}
              <p class="text-xs text-muted-foreground">
                {flowController.flow.instructions}
              </p>
            {/if}
          {:else if flowController.flow.status === "device_code" && flowController.flow.deviceCode}
            <div class="grid justify-items-start gap-2">
              <Button
                variant="outline"
                onclick={() =>
                  flowController.flow?.deviceCode &&
                  flowController.openExternal(
                    flowController.flow.deviceCode.verificationUri,
                  )}
              >
                <ExternalLink size={15} strokeWidth={2} />
                Open verification page
              </Button>
              <p class="text-xs text-muted-foreground">Enter this code:</p>
              <code
                class="rounded-md border border-border/60 bg-muted px-2 py-1 font-mono text-base tracking-widest text-foreground"
                >{flowController.flow.deviceCode.userCode}</code
              >
            </div>
          {:else if flowController.flow.status === "select" && flowController.flow.options}
            <div class="grid gap-2">
              {#each flowController.flow.options as option (option.id)}
                <Button
                  variant="outline"
                  disabled={flowController.busy}
                  onclick={() => void flowController.selectOption(option.id)}
                >
                  {option.label}
                </Button>
              {/each}
            </div>
          {:else if flowController.flow.status === "prompt"}
            <form
              class="grid gap-2"
              onsubmit={(event) => {
                event.preventDefault();
                void flowController.submitPrompt();
              }}
            >
              {#if flowController.flow.authUrl}
                <Button
                  variant="outline"
                  onclick={() =>
                    flowController.flow?.authUrl &&
                    flowController.openExternal(flowController.flow.authUrl)}
                >
                  <ExternalLink size={15} strokeWidth={2} />
                  Open login page
                </Button>
              {/if}
              {#if flowController.flow.instructions}
                <p class="text-xs text-muted-foreground">
                  {flowController.flow.instructions}
                </p>
              {/if}
              <Input
                size="xs"
                type="text"
                autocomplete="off"
                placeholder={flowController.flow.placeholder ??
                  "Paste the code or redirect URL"}
                bind:value={flowController.promptValue}
                disabled={flowController.busy}
              />
            </form>
          {:else if flowController.flow.status === "failed"}
            <div class="grid gap-2">
              <p class="text-sm text-destructive">
                The login attempt ended before credentials were saved.
              </p>
              <p class="text-xs text-muted-foreground">
                Fix any proxy or certificate settings, then start a fresh login.
                Authorization codes are one-time and may be tied to the ended
                login attempt.
                {#if flowController.flow.provider === "openai-codex"}
                  If local redirects are blocked, choose device-code login when
                  prompted.
                {/if}
              </p>
              <Button
                variant="outline"
                disabled={flowController.busy}
                onclick={() => void flowController.restartOAuth()}
              >
                Start a fresh login
              </Button>
            </div>
          {:else if flowController.flow.status === "succeeded"}
            <p class="text-sm font-medium text-success">
              Connected to {flowController.flow.providerName}.
            </p>
          {:else}
            <p class="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Working…
            </p>
          {/if}
        {:else}
          <p class="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Starting login…
          </p>
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
    {:else if flowController.step === "oauth" && flowController.flow?.status === "prompt"}
      <Button
        size="sm"
        onclick={() => void flowController.submitPrompt()}
        disabled={flowController.busy ||
          (!flowController.flow.allowEmpty &&
            flowController.promptValue.trim().length === 0)}
      >
        Submit
      </Button>
    {/if}
  {/snippet}
</Dialog>
