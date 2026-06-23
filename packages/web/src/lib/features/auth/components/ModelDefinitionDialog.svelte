<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { ModelDefinition, ThinkingLevel } from "$lib/api";
  import { upsertModelDefinition } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import Dialog from "$lib/components/ui/dialog-shell";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import SelectField, {
    type SelectItem,
  } from "$lib/components/ui/select-field";
  import Switch from "$lib/components/ui/switch-field";
  import { Textarea } from "$lib/components/ui/textarea";
  import { authState } from "$lib/features/auth/state/auth-state.svelte";
  import { refreshProviderCatalog } from "$lib/features/auth/state/auth.svelte";

  type Props = {
    open?: boolean;
    model?: ModelDefinition;
    providerItems?: SelectItem[];
  };

  let {
    open = $bindable(false),
    model,
    providerItems = [],
  }: Props = $props();

  const editing = $derived(Boolean(model));
  const THINKING_LEVELS: ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ];

  let provider = $state("");
  let modelId = $state("");
  let name = $state("");
  let reasoning = $state(false);
  let thinking = $state<ThinkingLevel[]>(["off"]);
  let imageInput = $state(false);
  let contextWindow = $state(0);
  let maxTokens = $state(0);
  let headersText = $state("");
  let busy = $state(false);
  let error = $state<string | undefined>(undefined);

  const selectProviderItems = $derived<SelectItem[]>(
    editing &&
      model?.provider &&
      !providerItems.some((item) => item.value === model.provider)
      ? [
          { value: model.provider, label: model.provider, detail: "Unavailable" },
          ...providerItems,
        ]
      : providerItems,
  );
  const isCustomProvider = $derived(
    authState.customProviders.some((custom) => custom.id === provider),
  );
  const providerAvailable = $derived(
    providerItems.some((item) => item.value === provider),
  );

  $effect(() => {
    if (!open) return;
    provider = model?.provider ?? "";
    modelId = model?.modelId ?? "";
    name = model?.name ?? "";
    reasoning = model?.reasoning ?? false;
    thinking = model?.supportedThinkingLevels ?? ["off"];
    imageInput = model?.input?.includes("image") ?? false;
    contextWindow = model?.contextWindow ?? 0;
    maxTokens = model?.maxTokens ?? 0;
    headersText = headersToText(model?.headers);
    error = undefined;
  });

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
      if (key) headers[key] = trimmed.slice(index + 1).trim();
    }
    return headers;
  }

  function toggleThinking(level: ThinkingLevel) {
    thinking = thinking.includes(level)
      ? thinking.filter((value) => value !== level)
      : [...thinking, level];
  }

  const canSubmit = $derived(
    provider.trim().length > 0 &&
      providerAvailable &&
      modelId.trim().length > 0 &&
      name.trim().length > 0 &&
      !busy,
  );

  async function submit() {
    if (!canSubmit) return;
    busy = true;
    error = undefined;
    try {
      const headers = parseHeaders(headersText);
      const next: ModelDefinition = {
        provider,
        modelId: modelId.trim(),
        name: name.trim(),
        reasoning,
        supportedThinkingLevels: thinking.length > 0 ? thinking : ["off"],
        input: imageInput ? ["text", "image"] : ["text"],
        contextWindow: Math.max(0, Math.trunc(contextWindow)),
        maxTokens: Math.max(0, Math.trunc(maxTokens)),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
      await upsertModelDefinition(next);
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
  title={editing ? `Edit ${model?.name}` : "Add model"}
  description="Register a model under a configured or authenticated provider."
>
  <div class="model-form">
    <div class="field">
      <Label>Provider</Label>
      <SelectField
        items={selectProviderItems}
        value={provider}
        onValueChange={(value) => (provider = value)}
        placeholder="Select a provider"
        ariaLabel="Provider"
        disabled={editing}
      />
    </div>

    <div class="field-grid">
      <div class="field">
        <Label for="model-id">Model id</Label>
        <Input id="model-id" bind:value={modelId} placeholder="llama-3.1-8b" disabled={busy || editing} />
      </div>
      <div class="field">
        <Label for="model-name">Display name</Label>
        <Input id="model-name" bind:value={name} placeholder="Llama 3.1 8B" disabled={busy} />
      </div>
    </div>

    {#if provider.length > 0 && !providerAvailable}
      <p class="field-hint" data-tone="error">
        <TriangleAlert size={14} strokeWidth={2} />
        This provider is not configured or authenticated.
      </p>
    {/if}

    <div class="field-grid">
      <div class="field">
        <Label for="model-context">Context window (tokens)</Label>
        <Input id="model-context" type="number" min="0" bind:value={contextWindow} disabled={busy} />
      </div>
      <div class="field">
        <Label for="model-max-tokens">Max output tokens</Label>
        <Input id="model-max-tokens" type="number" min="0" bind:value={maxTokens} disabled={busy} />
      </div>
    </div>

    <Switch
      class="settings-full-switch"
      checked={reasoning}
      label="Reasoning model"
      description="Enable thinking/reasoning controls for this model."
      onCheckedChange={(value) => (reasoning = value)}
    />

    <div class="field">
      <Label>Supported thinking levels</Label>
      <div class="chip-row">
        {#each THINKING_LEVELS as level (level)}
          <button
            type="button"
            class="chip"
            class:active={thinking.includes(level)}
            onclick={() => toggleThinking(level)}
          >
            {level}
          </button>
        {/each}
      </div>
    </div>

    <Switch
      class="settings-full-switch"
      checked={imageInput}
      label="Image input"
      description="The model accepts image content in addition to text."
      onCheckedChange={(value) => (imageInput = value)}
    />

    {#if isCustomProvider}
      <div class="field">
        <Label for="model-headers">Header overrides (optional)</Label>
        <Textarea id="model-headers" bind:value={headersText} rows={2} placeholder={"X-Header: value"} disabled={busy} />
        <p class="field-hint">Merged on top of the provider headers. One <code>Name: value</code> per line.</p>
      </div>
    {/if}

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
      {busy ? "Saving…" : editing ? "Save model" : "Add model"}
    </Button>
  {/snippet}
</Dialog>

<style>
  .model-form {
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

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chip {
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted-foreground);
    padding: 0.25rem 0.6rem;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .chip.active {
    border-color: color-mix(in oklab, var(--primary) 55%, transparent);
    background: color-mix(in oklab, var(--primary) 15%, transparent);
    color: var(--foreground);
  }

  @media (max-width: 540px) {
    .field-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
