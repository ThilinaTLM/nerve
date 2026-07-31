<script lang="ts">
import type {
  CreateTaskDefinitionRequest,
  UpdateTaskDefinitionRequest,
} from "@nervekit/contracts";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import type { TaskPanelDefinition } from "./task-panel-types";

type Props = {
  open?: boolean;
  definition?: TaskPanelDefinition;
  initial?: { label?: string; command: string; cwd?: string };
  projectCwd?: string;
  saving?: boolean;
  title?: string;
  description?: string;
  submitLabel?: string;
  onSave?: (
    input: CreateTaskDefinitionRequest | UpdateTaskDefinitionRequest,
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

let label = $state("");
let commandText = $state("");
let cwd = $state("");
let runPolicy = $state<"single" | "concurrent">("single");

const dialogTitle = $derived(
  title ?? (definition ? "Edit task" : "Create task"),
);
const dialogDescription = $derived(
  description ??
    (definition
      ? "Update this task definition and its launch policy. Existing runs keep their original command."
      : "Create a reusable task definition for this workspace."),
);
const dialogSubmitLabel = $derived(
  submitLabel ?? (definition ? "Save task" : "Create task"),
);
const canSave = $derived(!saving && commandText.trim().length > 0);

$effect(() => {
  if (!open) return;
  const source = definition ?? initial;
  label = source?.label ?? "";
  commandText = source?.command ?? "";
  cwd = source?.cwd ?? "";
  runPolicy = definition?.runPolicy ?? "single";
});

function submit() {
  if (!canSave) return;
  const nextLabel = label.trim();
  const nextCwd = cwd.trim();
  onSave?.({
    command: commandText.trim(),
    ...(nextLabel.length > 0 ? { label: nextLabel } : {}),
    ...(nextCwd.length > 0 ? { cwd: nextCwd } : {}),
    runPolicy,
  });
}
</script>

<Dialog
  bind:open
  title={dialogTitle}
  description={dialogDescription}
  class="max-w-xl"
  {onOpenChange}
>
  <div class="grid gap-4">
    <div class="grid gap-1.5">
      <Label for="task-definition-label">Label</Label>
      <Input
        id="task-definition-label"
        bind:value={label}
        placeholder="web-dev"
        disabled={saving}
      />
    </div>

    <div class="grid gap-1.5">
      <Label for="task-definition-command">Command</Label>
      <Textarea
        id="task-definition-command"
        bind:value={commandText}
        rows={4}
        placeholder="pnpm dev"
        class="font-mono text-xs"
        disabled={saving}
      />
      <p class="text-xs text-muted-foreground">
        This is the shell command run by the play button.
      </p>
    </div>

    <div class="grid gap-1.5">
      <Label for="task-run-policy">Run policy</Label>
      <SelectField
        bind:value={runPolicy}
        ariaLabel="Task run policy"
        items={[
          { value: "single", label: "Single run" },
          { value: "concurrent", label: "Concurrent runs" },
        ]}
        disabled={saving}
      />
      <p class="text-xs text-muted-foreground">
        Single run focuses an existing process. Concurrent runs may start
        another process.
      </p>
    </div>

    <div class="grid gap-1.5">
      <Label for="task-definition-cwd">Working directory</Label>
      <Input
        id="task-definition-cwd"
        bind:value={cwd}
        placeholder={projectCwd
          ? `Default: ${projectCwd}`
          : "Default working directory"}
        class="font-mono text-xs"
        disabled={saving}
      />
      <p class="text-xs text-muted-foreground">
        Leave blank to use the default working directory.
      </p>
    </div>
  </div>

  {#snippet footer()}
    <Button
      size="sm"
      variant="ghost"
      onclick={() => (open = false)}
      disabled={saving}>Cancel</Button
    >
    <Button size="sm" onclick={submit} disabled={!canSave}
      >{saving ? "Saving…" : dialogSubmitLabel}</Button
    >
  {/snippet}
</Dialog>
