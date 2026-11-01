<script lang="ts" module>
import type { SelectItem } from "@nervekit/ui-kit/components/composites/select-field";

export const PI_API_ITEMS: SelectItem[] = [
  {
    value: "openai-completions",
    label: "OpenAI Chat Completions",
    detail: "OpenAI-compatible (Ollama, vLLM, Together, Groq…)",
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses",
    detail: "OpenAI Responses API",
  },
  { value: "azure-openai-responses", label: "Azure OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "google-vertex", label: "Google Vertex AI" },
  { value: "mistral-conversations", label: "Mistral Conversations" },
  { value: "bedrock-converse-stream", label: "Amazon Bedrock Converse" },
  { value: "openai-codex-responses", label: "OpenAI Codex Responses" },
];
</script>

<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { CustomProvider, PiApi } from "$lib/api";
import {
  getCredentialKey,
  setProviderApiKey,
  upsertCustomProvider,
} from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import ProviderIcon from "$lib/presentation/model-picker/ProviderIcon.svelte";
import PopoverPanel, {
  PopoverCommandList,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { providerSearchKeywords } from "./provider-profiles";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { encryptApiKey } from "$lib/platform/crypto/credential-crypto";
import { refreshProviderCatalog } from "$lib/features/settings/state/provider-catalog-actions.svelte";

type Props = {
  open?: boolean;
  provider?: CustomProvider;
  hasKey?: boolean;
};

let { open = $bindable(false), provider, hasKey = false }: Props = $props();

const editing = $derived(Boolean(provider));

let displayName = $state("");
let id = $state("");
let api = $state<PiApi>("openai-completions");
let apiOpen = $state(false);
const apiItems = PI_API_ITEMS.map((item) => {
  const family = item.value.startsWith("bedrock")
    ? "amazon-bedrock"
    : item.value.startsWith("azure")
      ? "openai"
      : item.value.startsWith("openai-codex")
        ? "openai-codex"
        : item.value.split("-")[0];
  return {
    key: item.value,
    label: item.label,
    detail: item.detail,
    family,
    group: item.value.includes("openai")
      ? "OpenAI-compatible"
      : "Other provider APIs",
    keywords: [
      ...providerSearchKeywords(family, item.label),
      item.value,
      item.detail ?? "",
    ],
  };
});
let baseUrl = $state("");
let headersText = $state("");
let compatText = $state("");
let apiKey = $state("");
let idTouched = $state(false);
let busy = $state(false);
let error = $state<string | undefined>(undefined);

// Reset form state whenever the dialog opens for a (possibly new) provider.
$effect(() => {
  if (!open) return;
  displayName = provider?.displayName ?? "";
  id = provider?.id ?? "";
  apiOpen = false;
  api = provider?.api ?? "openai-completions";
  baseUrl = provider?.baseUrl ?? "";
  headersText = headersToText(provider?.headers);
  compatText = provider?.compat ? JSON.stringify(provider.compat, null, 2) : "";
  apiKey = "";
  idTouched = false;
  error = undefined;
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function headersToText(headers?: Record<string, string>): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf(":");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

function onDisplayNameInput(value: string) {
  displayName = value;
  if (!editing && !idTouched) id = slugify(value);
}

const idValid = $derived(/^[a-z0-9][a-z0-9-]*$/.test(id));
const canSubmit = $derived(
  displayName.trim().length > 0 &&
    idValid &&
    baseUrl.trim().length > 0 &&
    !busy,
);

async function submit() {
  if (!canSubmit) return;
  busy = true;
  error = undefined;
  try {
    let compat: Record<string, unknown> | undefined;
    if (compatText.trim()) {
      try {
        compat = JSON.parse(compatText) as Record<string, unknown>;
      } catch {
        throw new Error("Compatibility overrides must be valid JSON.");
      }
    }
    const next: CustomProvider = {
      id,
      displayName: displayName.trim(),
      api,
      baseUrl: baseUrl.trim(),
      headers: parseHeaders(headersText),
      ...(compat ? { compat } : {}),
    };
    await upsertCustomProvider(next);
    const trimmedKey = apiKey.trim();
    if (trimmedKey) {
      const credentialKey = await getCredentialKey();
      const envelope = await encryptApiKey(trimmedKey, credentialKey);
      await setProviderApiKey(id, envelope);
    }
    await refreshProviderCatalog();
    open = false;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    busy = false;
  }
}
</script>

<Dialog
  bind:open
  title={editing ? `Edit ${provider?.displayName}` : "Add custom provider"}
  description="Connect an OpenAI-compatible or other pi-ai supported endpoint."
  size="sm"
>
  <div class="grid gap-3">
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="grid gap-1.5">
        <Label for="custom-provider-name">Display name</Label>
        <Input
          id="custom-provider-name"
          value={displayName}
          oninput={(event) => onDisplayNameInput(event.currentTarget.value)}
          placeholder="My local server"
          disabled={busy}
        />
      </div>
      <div class="grid gap-1.5">
        <Label for="custom-provider-id">Provider id</Label>
        <Input
          id="custom-provider-id"
          bind:value={id}
          oninput={() => (idTouched = true)}
          placeholder="ollama"
          disabled={busy || editing}
          aria-invalid={!idValid && id.length > 0}
        />
        {#if id.length > 0 && !idValid}
          <p class="flex items-center gap-1.5 text-ui text-destructive">
            Use lowercase letters, numbers, and dashes.
          </p>
        {/if}
      </div>
    </div>

    <div class="grid gap-1.5">
      <Label>API type</Label>
      <PopoverPanel
        bind:open={apiOpen}
        variant="field"
        size="lg"
        ariaLabel="API type"
      >
        {#snippet triggerChild({ props })}
          <Button {...props} variant="outline" disabled={busy}>
            <ProviderIcon
              provider={apiItems.find((item) => item.key === api)?.family ??
                api}
              class="size-4"
            />
            {apiItems.find((item) => item.key === api)?.label ?? api}
          </Button>
        {/snippet}
        {#if apiOpen}
          <PopoverCommandList
            items={apiItems}
            ariaLabel="API types"
            placeholder="Search provider APIs…"
            isSelected={(item) => item.key === api}
            onChoose={(item) => {
              api = item.key as PiApi;
              apiOpen = false;
            }}
          >
            {#snippet icon(item)}<ProviderIcon
                provider={item.family}
                class="size-4"
              />{/snippet}
          </PopoverCommandList>
        {/if}
      </PopoverPanel>
    </div>

    <div class="grid gap-1.5">
      <Label for="custom-provider-base-url">Base URL</Label>
      <Input
        id="custom-provider-base-url"
        bind:value={baseUrl}
        placeholder="http://localhost:11434/v1"
        disabled={busy}
      />
    </div>

    <div class="grid gap-1.5">
      <Label for="custom-provider-key">
        API key {hasKey ? "(stored — leave blank to keep)" : "(optional)"}
      </Label>
      <Input
        id="custom-provider-key"
        type="password"
        autocomplete="off"
        bind:value={apiKey}
        placeholder={hasKey ? "Paste a replacement key" : "Paste an API key"}
        disabled={busy}
      />
    </div>

    <div class="grid gap-1.5">
      <Label for="custom-provider-headers">Custom headers (optional)</Label>
      <Textarea
        id="custom-provider-headers"
        bind:value={headersText}
        rows={3}
        placeholder="X-Header: value
Another-Header: value"
        disabled={busy}
      />
      <p class="text-ui text-muted-foreground">
        One <code class="font-mono">Name: value</code> per line.
      </p>
    </div>

    <div class="grid gap-1.5">
      <Label for="custom-provider-compat"
        >Compatibility overrides (optional JSON)</Label
      >
      <Textarea
        id="custom-provider-compat"
        bind:value={compatText}
        rows={3}
        placeholder={'{ "supportsDeveloperRole": false }'}
        disabled={busy}
      />
    </div>

    {#if error}
      <p class="flex items-center gap-1.5 text-ui text-destructive">
        <TriangleAlert size={14} strokeWidth={2} />
        {error}
      </p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button onclick={() => void submit()} disabled={!canSubmit}>
      {busy ? "Saving…" : editing ? "Save provider" : "Add provider"}
    </Button>
  {/snippet}
</Dialog>
