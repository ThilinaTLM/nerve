<script lang="ts">
import { untrack } from "svelte";
import type { UpdateTaskDefinitionRequest } from "@nervekit/contracts/task-definitions";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";
import SwitchField from "@nervekit/ui-kit/components/composites/switch-field";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import {
  isValidTaskPort,
  taskDefinitionRequest,
} from "$lib/features/tasks/views/task-panel-controller";

/**
 * Phone form for a saved task. Mount it fresh for every open (the caller keys
 * it) so each edit starts from its source values. Validation and the request
 * shape are shared with the desktop dialog.
 */
let {
  title,
  submitLabel,
  source,
  projectDir,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  source?: {
    label?: string;
    command: string;
    cwd?: string;
    port?: number;
    runPolicy?: "single" | "concurrent";
  };
  projectDir?: string;
  onSubmit: (request: UpdateTaskDefinitionRequest) => Promise<void>;
  onClose: () => void;
} = $props();

const initial = untrack(() => source);
let label = $state(initial?.label ?? "");
let command = $state(initial?.command ?? "");
let cwd = $state(initial?.cwd ?? "");
// A cleared number input binds null; the shared rules speak undefined.
let portValue = $state<number | null | undefined>(initial?.port);
let concurrent = $state(initial?.runPolicy === "concurrent");
let open = $state(true);
let saving = $state(false);
let error = $state<string>();

const port = $derived(
  portValue === null || portValue === undefined || Number.isNaN(portValue)
    ? undefined
    : portValue,
);
const request = $derived(
  taskDefinitionRequest({
    label,
    command,
    cwd,
    port,
    runPolicy: concurrent ? "concurrent" : "single",
  }),
);

function close() {
  open = false;
  onClose();
}

async function submit(event: SubmitEvent) {
  event.preventDefault();
  if (!request || saving) return;
  saving = true;
  error = undefined;
  try {
    await onSubmit(request);
    close();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
  }
}
</script>

<Sheet.Root
  {open}
  onOpenChange={(next) => {
    if (!next && !saving) close();
  }}
>
  <Sheet.Content
    side="bottom"
    class="max-h-[90dvh] rounded-t-lg pb-[env(safe-area-inset-bottom)]"
  >
    <Sheet.Title class="px-4 pb-1 pt-3 text-sm font-semibold"
      >{title}</Sheet.Title
    >
    <form
      class="grid min-h-0 gap-3 overflow-y-auto px-4 pb-4"
      onsubmit={submit}
    >
      <div class="grid gap-1.5">
        <Label for="mobile-task-label">Name</Label>
        <Input
          id="mobile-task-label"
          bind:value={label}
          placeholder="web-dev"
          disabled={saving}
        />
      </div>
      <div class="grid gap-1.5">
        <Label for="mobile-task-command">Command</Label>
        <Textarea
          id="mobile-task-command"
          bind:value={command}
          rows={3}
          placeholder="pnpm dev"
          autocapitalize="off"
          spellcheck={false}
          class="font-mono"
          disabled={saving}
          required
        />
      </div>
      <div class="grid gap-1.5">
        <Label for="mobile-task-cwd">Folder</Label>
        <Input
          id="mobile-task-cwd"
          bind:value={cwd}
          placeholder={projectDir ?? "Project folder"}
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          class="font-mono"
          disabled={saving}
        />
        <p class="text-xs text-muted-foreground">
          Leave blank to use the project folder. Relative paths resolve from it.
        </p>
      </div>
      <div class="grid gap-1.5">
        <Label for="mobile-task-port">Port</Label>
        <Input
          id="mobile-task-port"
          bind:value={portValue}
          type="number"
          inputmode="numeric"
          min="1"
          max="65535"
          placeholder="3000"
          disabled={saving}
          aria-invalid={!isValidTaskPort(port)}
        />
        <p class="text-xs text-muted-foreground">
          Optional. Nerve checks this port is free before the task starts.
        </p>
      </div>
      <SwitchField
        bind:checked={concurrent}
        label="Allow parallel runs"
        description="Otherwise running it again shows the existing run."
        disabled={saving}
      />
      {#if error}
        <p class="text-xs text-destructive" role="alert">{error}</p>
      {/if}
      <div class="flex justify-end gap-2">
        <Button variant="ghost" onclick={close} disabled={saving}>Cancel</Button
        >
        <Button type="submit" disabled={!request || saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  </Sheet.Content>
</Sheet.Root>
