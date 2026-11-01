<script lang="ts">
import { untrack } from "svelte";
import type { UpdateLaunchDefinitionRequest } from "@nervekit/contracts/launch-definitions";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";
import SwitchField from "@nervekit/ui-kit/components/composites/switch-field";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import {
  isValidLaunchPort,
  launchDefinitionRequest,
} from "$lib/features/launches/views/launch-panel-controller";

/**
 * Phone form for a saved launch. Mount it fresh for every open (the caller keys
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
  onSubmit: (request: UpdateLaunchDefinitionRequest) => Promise<void>;
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
  launchDefinitionRequest({
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
    <Sheet.Title class="px-4 pb-1 pt-3 text-ui font-semibold"
      >{title}</Sheet.Title
    >
    <form
      class="grid min-h-0 gap-3 overflow-y-auto px-4 pb-4"
      onsubmit={submit}
    >
      <div class="grid gap-1.5">
        <Label for="mobile-launch-label">Name</Label>
        <Input
          id="mobile-launch-label"
          bind:value={label}
          placeholder="web-dev"
          disabled={saving}
        />
      </div>
      <div class="grid gap-1.5">
        <Label for="mobile-launch-command">Command</Label>
        <Textarea
          id="mobile-launch-command"
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
        <Label for="mobile-launch-cwd">Folder</Label>
        <Input
          id="mobile-launch-cwd"
          bind:value={cwd}
          placeholder={projectDir ?? "Project folder"}
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          class="font-mono"
          disabled={saving}
        />
        <p class="text-ui text-muted-foreground">
          Leave blank to use the project folder. Relative paths resolve from it.
        </p>
      </div>
      <div class="grid gap-1.5">
        <Label for="mobile-launch-port">Port</Label>
        <Input
          id="mobile-launch-port"
          bind:value={portValue}
          type="number"
          inputmode="numeric"
          min="1"
          max="65535"
          placeholder="3000"
          disabled={saving}
          aria-invalid={!isValidLaunchPort(port)}
        />
        <p class="text-ui text-muted-foreground">
          Optional. Nerve checks this port is free before the launch starts.
        </p>
      </div>
      <SwitchField
        bind:checked={concurrent}
        label="Allow parallel runs"
        description="Otherwise running it again shows the existing run."
        disabled={saving}
      />
      {#if error}
        <p class="text-ui text-destructive" role="alert">{error}</p>
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
