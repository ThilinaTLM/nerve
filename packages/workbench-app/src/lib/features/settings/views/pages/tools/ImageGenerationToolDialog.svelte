<script lang="ts">
import { openAiCodexImageSizeSchema } from "$lib/api";
import type {
  ImageGenerationProvider,
  OpenAiCodexImageBackground,
  OpenAiCodexImageModel,
  OpenAiCodexImageQuality,
  Settings,
} from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import type { SettingsChange } from "../settings-change";

type Props = {
  open?: boolean;
  settingsDraft: Settings;
  onSettingsChange?: SettingsChange;
};

let {
  open = $bindable(false),
  settingsDraft,
  onSettingsChange,
}: Props = $props();

const providerOptions = [
  {
    value: "openai-codex",
    label: "OpenAI Codex subscription",
    detail: "Generate through the connected ChatGPT subscription.",
  },
];
const modelOptions = [
  {
    value: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    detail: "Fast, high-quality everyday generation.",
  },
  {
    value: "gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    detail: "Highest quality and precision-focused generation.",
  },
];
const qualityOptions = ["auto", "low", "medium", "high", "xhigh", "max"].map(
  (value) => ({
    value,
    label: value === "auto" ? "Auto" : value.toUpperCase(),
  }),
);
const backgroundOptions = [
  { value: "auto", label: "Auto" },
  { value: "opaque", label: "Opaque" },
  { value: "transparent", label: "Transparent" },
];

let providerDraft = $state<ImageGenerationProvider>("openai-codex");
let modelDraft = $state<OpenAiCodexImageModel>("gpt-image-2.5-flare");
let qualityDraft = $state<OpenAiCodexImageQuality>("auto");
let sizeDraft = $state("auto");
let backgroundDraft = $state<OpenAiCodexImageBackground>("auto");
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    const settings = settingsDraft.tools.imageGeneration;
    providerDraft = settings.provider;
    modelDraft = settings.model;
    qualityDraft = settings.options.quality;
    sizeDraft = settings.options.size;
    backgroundDraft = settings.options.background;
  }
  lastOpen = open;
});

const validSize = $derived(
  openAiCodexImageSizeSchema.safeParse(sizeDraft).success,
);

function save(): void {
  if (!validSize) return;
  const imageGeneration = {
    provider: providerDraft,
    model: modelDraft,
    options: {
      quality: qualityDraft,
      size: sizeDraft,
      background: backgroundDraft,
    },
  } as const;
  settingsDraft.tools.imageGeneration = imageGeneration;
  onSettingsChange?.({ tools: { imageGeneration } }, { immediate: true });
  open = false;
}
</script>

<Dialog
  bind:open
  size="sm"
  title="Configure image generation"
  description="Choose the provider, model, and output defaults used for every generation."
>
  <div class="grid gap-4">
    <div class="grid gap-1.5">
      <Label>Provider</Label>
      <SelectField
        items={providerOptions}
        value={providerDraft}
        ariaLabel="Image generation provider"
        onValueChange={(value) =>
          (providerDraft = value as ImageGenerationProvider)}
      />
    </div>

    {#if providerDraft === "openai-codex"}
      <div class="grid gap-1.5">
        <Label>Model</Label>
        <SelectField
          items={modelOptions}
          value={modelDraft}
          ariaLabel="OpenAI image model"
          onValueChange={(value) =>
            (modelDraft = value as OpenAiCodexImageModel)}
        />
      </div>
      <div class="grid gap-1.5">
        <Label>Quality</Label>
        <SelectField
          items={qualityOptions}
          value={qualityDraft}
          ariaLabel="OpenAI image quality"
          onValueChange={(value) =>
            (qualityDraft = value as OpenAiCodexImageQuality)}
        />
      </div>
      <div class="grid gap-1.5">
        <Label for="tools-image-generation-size">Size</Label>
        <Input
          id="tools-image-generation-size"
          size="sm"
          bind:value={sizeDraft}
          aria-invalid={validSize ? undefined : "true"}
          placeholder="auto or 1024x1024"
        />
        <p
          class={validSize
            ? "text-xs text-muted-foreground"
            : "text-xs text-destructive"}
        >
          Use auto or WIDTHxHEIGHT. Dimensions must be multiples of 16 and at
          most 3840px.
        </p>
      </div>
      <div class="grid gap-1.5">
        <Label>Background</Label>
        <SelectField
          items={backgroundOptions}
          value={backgroundDraft}
          ariaLabel="OpenAI image background"
          onValueChange={(value) =>
            (backgroundDraft = value as OpenAiCodexImageBackground)}
        />
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => (open = false)}>
      Cancel
    </Button>
    <Button size="sm" onclick={save} disabled={!validSize}>Save</Button>
  {/snippet}
</Dialog>
