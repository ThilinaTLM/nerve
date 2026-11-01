<script lang="ts">
import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { compactionProfileItems } from "$lib/presentation/settings/compaction-options";
import {
  compactionDraftError,
  compactionsEqual,
  formatBytes,
  INSTRUCTIONS_MAX_BYTES,
  instructionsBytes,
  instructionsOverLimit,
  instructionsPatch,
} from "./conversation-settings";

/**
 * Edit dialogs for the conversation's compaction override and instructions.
 * Drafts reset from the current values each time a dialog opens.
 */
let {
  compactionOpen = $bindable(false),
  instructionsOpen = $bindable(false),
  compaction,
  compactionOverridden = false,
  instructions,
  onSaveCompaction,
  onResetCompaction,
  onSaveInstructions,
}: {
  compactionOpen?: boolean;
  instructionsOpen?: boolean;
  /** The effective compaction the override starts from. */
  compaction: AutoCompactionSettings | undefined;
  /** This conversation overrides the inherited compaction. */
  compactionOverridden?: boolean;
  instructions: string | null | undefined;
  onSaveCompaction: (value: AutoCompactionSettings) => Promise<void>;
  /** Drops the override, so the conversation inherits again. */
  onResetCompaction: () => Promise<void>;
  /** `null` clears. */
  onSaveInstructions: (value: string | null) => Promise<void>;
} = $props();

let draft = $state<AutoCompactionSettings>({
  auto: true,
  profile: "balanced",
  customTriggerPercent: 80,
});
let text = $state("");
let saving = $state(false);
let failure = $state<string>();

let wasCompactionOpen = false;
$effect(() => {
  if (compactionOpen && !wasCompactionOpen && compaction) {
    draft = { ...compaction };
    failure = undefined;
  }
  wasCompactionOpen = compactionOpen;
});
let wasInstructionsOpen = false;
$effect(() => {
  if (instructionsOpen && !wasInstructionsOpen) {
    text = instructions ?? "";
    failure = undefined;
  }
  wasInstructionsOpen = instructionsOpen;
});

const compactionError = $derived(compactionDraftError(draft));
const compactionChanged = $derived(
  !compaction || !compactionsEqual(compaction, draft),
);
const bytes = $derived(instructionsBytes(text));
const overLimit = $derived(instructionsOverLimit(text));

async function run(action: () => Promise<void>, close: () => void) {
  saving = true;
  failure = undefined;
  try {
    await action();
    close();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    saving = false;
  }
}

function setTriggerPercent(value: string) {
  draft.customTriggerPercent = Number(value);
}
</script>

<Dialog
  bind:open={compactionOpen}
  size="sm"
  title="Compaction for this conversation"
  description="Applies to this conversation only; it inherits the project or user setting until you change it."
>
  <div class="grid gap-3">
    <div class="flex items-center justify-between gap-3">
      <Label for="conversation-compaction-auto">Auto-compact</Label>
      <Switch
        id="conversation-compaction-auto"
        bind:checked={draft.auto}
        disabled={saving}
      />
    </div>
    {#if draft.auto}
      <SelectField
        items={compactionProfileItems}
        value={draft.profile}
        ariaLabel="Compaction profile"
        disabled={saving}
        onValueChange={(value) =>
          (draft.profile = value as AutoCompactionSettings["profile"])}
      />
      {#if draft.profile === "custom"}
        <div class="grid gap-3">
          <div class="grid gap-1.5">
            <Label for="conversation-compaction-trigger">Compact at (%)</Label>
            <Input
              id="conversation-compaction-trigger"
              type="number"
              min={60}
              max={90}
              value={String(draft.customTriggerPercent)}
              oninput={(event) => setTriggerPercent(event.currentTarget.value)}
            />
          </div>
        </div>
      {/if}
    {/if}
    {#if compactionError && draft.profile === "custom"}
      <p class="text-ui text-destructive" role="alert">{compactionError}</p>
    {/if}
    {#if failure}
      <p class="text-ui text-destructive" role="alert">{failure}</p>
    {/if}
  </div>
  {#snippet footer()}
    {#if compactionOverridden}
      <Button
        variant="ghost"
        disabled={saving}
        onclick={() =>
          void run(onResetCompaction, () => (compactionOpen = false))}
      >
        Use inherited
      </Button>
    {/if}
    <Button
      variant="ghost"
      disabled={saving}
      onclick={() => (compactionOpen = false)}
    >
      Cancel
    </Button>
    <Button
      disabled={saving || Boolean(compactionError) || !compactionChanged}
      onclick={() =>
        void run(
          () => onSaveCompaction({ ...draft }),
          () => (compactionOpen = false),
        )}
    >
      Save
    </Button>
  {/snippet}
</Dialog>

<Dialog
  bind:open={instructionsOpen}
  title="Instructions for this conversation"
  description="Added to the system prompt from the next turn."
>
  <div class="grid gap-1.5">
    <Textarea
      bind:value={text}
      aria-label="Instructions"
      class="min-h-48"
      placeholder="Markdown added to the system prompt."
      disabled={saving}
    />
    <p
      class={[
        "text-right text-ui tabular-nums",
        overLimit ? "text-destructive" : "text-muted-foreground",
      ]}
    >
      {formatBytes(bytes)} / {formatBytes(INSTRUCTIONS_MAX_BYTES)}
    </p>
    {#if failure}
      <p class="text-ui text-destructive" role="alert">{failure}</p>
    {/if}
  </div>
  {#snippet footer()}
    <Button
      variant="ghost"
      disabled={saving || !(instructions ?? "").length}
      onclick={() =>
        void run(
          () => onSaveInstructions(null),
          () => (instructionsOpen = false),
        )}
    >
      Clear
    </Button>
    <Button
      variant="ghost"
      disabled={saving}
      onclick={() => (instructionsOpen = false)}
    >
      Cancel
    </Button>
    <Button
      disabled={saving || overLimit}
      onclick={() =>
        void run(
          () => onSaveInstructions(instructionsPatch(text)),
          () => (instructionsOpen = false),
        )}
    >
      Save
    </Button>
  {/snippet}
</Dialog>
