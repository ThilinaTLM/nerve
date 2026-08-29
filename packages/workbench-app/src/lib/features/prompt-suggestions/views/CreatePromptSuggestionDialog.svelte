<script lang="ts">
import { tick } from "svelte";
import type { CreatePromptSuggestionRequest, ProjectRecord } from "$lib/api";
import {
  PROMPT_SUGGESTION_DESCRIPTION_MAX_LENGTH,
  PROMPT_SUGGESTION_LABEL_MAX_LENGTH,
  PROMPT_SUGGESTION_NAME_MAX_LENGTH,
  PROMPT_SUGGESTION_PROMPT_MAX_LENGTH,
  promptSuggestionNameSchema,
} from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";

type Props = {
  open?: boolean;
  project?: ProjectRecord;
  onCreate?: (request: CreatePromptSuggestionRequest) => Promise<void>;
};

let { open = $bindable(false), project, onCreate }: Props = $props();

let scope = $state<"user" | "project">("user");
let name = $state("");
let label = $state("");
let description = $state("");
let prompt = $state("");
let saving = $state(false);
let error = $state<string | undefined>(undefined);
let nameInput = $state<HTMLInputElement | null>(null);

const scopeItems = $derived([
  { value: "user", label: "User", detail: "Available in every project" },
  ...(project
    ? [
        {
          value: "project",
          label: "Project",
          detail: `Only in ${project.name}`,
        },
      ]
    : []),
]);
const nameValid = $derived(promptSuggestionNameSchema.safeParse(name).success);
const canCreate = $derived(
  !saving &&
    nameValid &&
    label.trim().length > 0 &&
    label.trim().length <= PROMPT_SUGGESTION_LABEL_MAX_LENGTH &&
    description.trim().length <= PROMPT_SUGGESTION_DESCRIPTION_MAX_LENGTH &&
    prompt.trim().length > 0 &&
    prompt.trim().length <= PROMPT_SUGGESTION_PROMPT_MAX_LENGTH &&
    (scope === "user" || Boolean(project)),
);
const destination = $derived(
  scope === "project" && project
    ? `${project.dir}/.nerve/suggestions/${name || "name"}.md`
    : `~/.nerve/suggestions/${name || "name"}.md`,
);

$effect(() => {
  if (!open) return;
  scope = "user";
  name = "";
  label = "";
  description = "";
  prompt = "";
  error = undefined;
  void tick().then(() => nameInput?.focus());
});

async function submit() {
  if (!canCreate || !onCreate) return;
  saving = true;
  error = undefined;
  try {
    await onCreate({
      scope,
      ...(scope === "project" && project ? { projectId: project.id } : {}),
      name: name.trim(),
      label: label.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      prompt: prompt.trim(),
    });
    open = false;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving = false;
  }
}
</script>

<Dialog
  bind:open
  title="New prompt suggestion"
  description="Create a reusable composer prompt in your user profile or the current project."
  size="md"
>
  <div class="grid gap-4">
    <div class="grid gap-1.5">
      <Label>Scope</Label>
      <SelectField items={scopeItems} bind:value={scope} disabled={saving} />
    </div>

    <div class="grid gap-1.5">
      <Label for="prompt-suggestion-name">Name</Label>
      <Input
        id="prompt-suggestion-name"
        bind:ref={nameInput}
        bind:value={name}
        maxlength={PROMPT_SUGGESTION_NAME_MAX_LENGTH}
        placeholder="review-diff"
        disabled={saving}
      />
      <p class="text-xs text-muted-foreground">
        Use lowercase letters, numbers, and single hyphens.
      </p>
    </div>

    <div class="grid gap-1.5">
      <Label for="prompt-suggestion-label">Label</Label>
      <Input
        id="prompt-suggestion-label"
        bind:value={label}
        maxlength={PROMPT_SUGGESTION_LABEL_MAX_LENGTH}
        placeholder="Review diff"
        disabled={saving}
      />
    </div>

    <div class="grid gap-1.5">
      <Label for="prompt-suggestion-description">Description (optional)</Label>
      <Input
        id="prompt-suggestion-description"
        bind:value={description}
        maxlength={PROMPT_SUGGESTION_DESCRIPTION_MAX_LENGTH}
        placeholder="Review current changes before committing."
        disabled={saving}
      />
    </div>

    <div class="grid gap-1.5">
      <Label for="prompt-suggestion-prompt">Prompt</Label>
      <Textarea
        id="prompt-suggestion-prompt"
        bind:value={prompt}
        maxlength={PROMPT_SUGGESTION_PROMPT_MAX_LENGTH}
        class="min-h-36"
        placeholder="Review the current diff for correctness risks and missing tests."
        disabled={saving}
      />
    </div>

    <div class="rounded-md bg-muted p-3 text-xs text-muted-foreground">
      <p class="break-all font-mono">{destination}</p>
      <p class="mt-2">
        The generated Markdown works immediately. Edit it later to add advanced
        conditions or a trusted JavaScript predicate.
      </p>
    </div>

    {#if error}
      <p class="text-sm text-destructive" role="alert">{error}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button
      size="sm"
      variant="ghost"
      onclick={() => (open = false)}
      disabled={saving}>Cancel</Button
    >
    <Button size="sm" onclick={() => void submit()} disabled={!canCreate}
      >{saving ? "Creating…" : "Create suggestion"}</Button
    >
  {/snippet}
</Dialog>
