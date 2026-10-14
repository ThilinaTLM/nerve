<script lang="ts">
import { untrack } from "svelte";
import type {
  CreateLaunchDefinitionRequest,
  UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import {
  isValidLaunchPort,
  launchDefinitionRequest,
} from "./launch-panel-controller";
import type { LaunchPanelDefinition } from "./launch-panel-types";

type Props = {
  open?: boolean;
  definition?: LaunchPanelDefinition;
  initial?: {
    label?: string;
    command: string;
    cwd?: string;
    port?: number;
    runPolicy?: "single" | "concurrent";
  };
  projectCwd?: string;
  saving?: boolean;
  title?: string;
  description?: string;
  submitLabel?: string;
  onSave?: (
    input: CreateLaunchDefinitionRequest | UpdateLaunchDefinitionRequest,
  ) => void;
  onOpenChange?: (open: boolean) => void;
};

let {
  open = $bindable(false),
  definition,
  initial,
  projectCwd,
  saving = false,
  title,
  description,
  submitLabel,
  onSave,
  onOpenChange,
}: Props = $props();

const source = untrack(() => definition ?? initial);
let label = $state(source?.label ?? "");
let commandText = $state(source?.command ?? "");
let cwd = $state(source?.cwd ?? "");
let port = $state<number | undefined>(source?.port);
let runPolicy = $state<"single" | "concurrent">(source?.runPolicy ?? "single");

const dialogTitle = $derived(
  title ?? (definition ? "Edit launch" : "Create launch"),
);
const dialogDescription = $derived(
  description ??
    (definition
      ? "Update this launch configuration and its launch policy. Existing runs keep their original command."
      : "Create a reusable launch configuration for this workspace."),
);
const dialogSubmitLabel = $derived(
  submitLabel ?? (definition ? "Save launch" : "Create launch"),
);
const portValid = $derived(isValidLaunchPort(port));
const request = $derived(
  launchDefinitionRequest({
    label,
    command: commandText,
    cwd,
    port,
    runPolicy,
  }),
);
const canSave = $derived(!saving && request !== undefined);

function submit() {
  if (!canSave || !request) return;
  onSave?.(request);
}
</script>

<Dialog
  bind:open
  title={dialogTitle}
  description={dialogDescription}
  size="sm"
  {onOpenChange}
>
  <div class="grid gap-3">
    <div class="grid gap-1.5">
      <Label for="launch-definition-label">Name</Label>
      <Input
        id="launch-definition-label"
        bind:value={label}
        placeholder="web-dev"
        disabled={saving}
      />
    </div>

    <div class="grid gap-1.5">
      <Label for="launch-definition-command">Command</Label>
      <Textarea
        id="launch-definition-command"
        bind:value={commandText}
        rows={3}
        placeholder="pnpm dev"
        class="min-h-20 py-1.5 font-mono text-xs md:text-xs"
        disabled={saving}
      />
      <p class="text-xs text-muted-foreground">
        This is the shell command run by the play button.
      </p>
    </div>

    <div class="grid gap-1.5">
      <Label for="launch-definition-port">Port</Label>
      <Input
        id="launch-definition-port"
        bind:value={port}
        type="number"
        min="1"
        max="65535"
        placeholder="3000"
        disabled={saving}
        aria-invalid={!portValid}
      />
      <p class="text-xs text-muted-foreground">
        Optional TCP port to check before this launch starts.
      </p>
    </div>

    <div class="grid gap-1.5">
      <Label for="launch-run-policy">Run policy</Label>
      <SelectField
        bind:value={runPolicy}
        ariaLabel="Launch run policy"
        items={[
          { value: "single", label: "Single run" },
          { value: "concurrent", label: "Concurrent runs" },
        ]}
        disabled={saving}
        triggerClass="h-7 px-2 text-xs"
      />
      <p class="text-xs text-muted-foreground">
        Single run focuses an existing process. Concurrent runs may start
        another process.
      </p>
    </div>

    <div class="grid gap-1.5">
      <Label for="launch-definition-cwd">Working directory</Label>
      <Input
        id="launch-definition-cwd"
        bind:value={cwd}
        placeholder={projectCwd
          ? `Default: ${projectCwd}`
          : "Default working directory"}
        class="font-mono text-xs"
        disabled={saving}
      />
      <p class="text-xs text-muted-foreground">
        Leave blank to use the project directory. Relative paths resolve from
        it.
      </p>
    </div>
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)} disabled={saving}
      >Cancel</Button
    >
    <Button onclick={submit} disabled={!canSave}
      >{saving ? "Saving…" : dialogSubmitLabel}</Button
    >
  {/snippet}
</Dialog>
