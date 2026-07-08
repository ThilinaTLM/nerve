<script lang="ts" module>
  import type { SelectItem } from "@nervekit/shared-ui/components/ui/select-field";

  export const PI_API_ITEMS: SelectItem[] = [
    { value: "openai-completions", label: "OpenAI Chat Completions", detail: "OpenAI-compatible (Ollama, vLLM, Together, Groq…)" },
    { value: "openai-responses", label: "OpenAI Responses", detail: "OpenAI Responses API" },
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
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import Dialog from "@nervekit/shared-ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/shared-ui/components/ui/input";
  import { Label } from "@nervekit/shared-ui/components/ui/label";
  import SelectField from "@nervekit/shared-ui/components/ui/select-field";
  import { Textarea } from "@nervekit/shared-ui/components/ui/textarea";
  import { encryptApiKey } from "$lib/core/utils/credential-crypto";
  import { refreshProviderCatalog } from "$lib/features/auth/state/auth.svelte";

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
    api = provider?.api ?? "openai-completions";
    baseUrl = provider?.baseUrl ?? "";
    headersText = headersToText(provider?.headers);
    compatText = provider?.compat
      ? JSON.stringify(provider.compat, null, 2)
      : "";
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
>
  <div class="provider-form">
    <div class="field-grid">
      <div class="field">
        <Label for="custom-provider-name">Display name</Label>
        <Input
          id="custom-provider-name"
          value={displayName}
          oninput={(event) => onDisplayNameInput(event.currentTarget.value)}
          placeholder="My local server"
          disabled={busy}
        />
      </div>
      <div class="field">
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
          <p class="field-hint" data-tone="error">Use lowercase letters, numbers, and dashes.</p>
        {/if}
      </div>
    </div>

    <div class="field">
      <Label>API type</Label>
      <SelectField
        items={PI_API_ITEMS}
        value={api}
        onValueChange={(value) => (api = value as PiApi)}
        ariaLabel="API type"
      />
    </div>

    <div class="field">
      <Label for="custom-provider-base-url">Base URL</Label>
      <Input
        id="custom-provider-base-url"
        bind:value={baseUrl}
        placeholder="http://localhost:11434/v1"
        disabled={busy}
      />
    </div>

    <div class="field">
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

    <div class="field">
      <Label for="custom-provider-headers">Custom headers (optional)</Label>
      <Textarea
        id="custom-provider-headers"
        bind:value={headersText}
        rows={3}
        placeholder={"X-Header: value\nAnother-Header: value"}
        disabled={busy}
      />
      <p class="field-hint">One <code>Name: value</code> per line.</p>
    </div>

    <div class="field">
      <Label for="custom-provider-compat">Compatibility overrides (optional JSON)</Label>
      <Textarea
        id="custom-provider-compat"
        bind:value={compatText}
        rows={3}
        placeholder={'{ "supportsDeveloperRole": false }'}
        disabled={busy}
      />
    </div>

    {#if error}
      <p class="field-hint" data-tone="error">
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

<style>
  .provider-form {
    display: grid;
    gap: 0.85rem;
    padding: 1rem 1.1rem;
  }

  .field-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.85rem;
  }

  .field {
    display: grid;
    gap: 0.35rem;
  }

  .field-hint {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .field-hint[data-tone="error"] {
    color: var(--destructive);
  }

  .field-hint code {
    font-family: var(--font-mono);
  }

  @media (max-width: 540px) {
    .field-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
