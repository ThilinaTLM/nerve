<script lang="ts">
  import type {
    CreatePinnedCommandRequest,
    PinnedCommand,
    SandboxPinnedCommand,
    UpdatePinnedCommandRequest,
  } from "@nervekit/contracts";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import Dialog from "@nervekit/workbench-ui/components/ui/dialog-shell";
  import { Input } from "@nervekit/workbench-ui/components/ui/input";
  import { Label } from "@nervekit/workbench-ui/components/ui/label";
  import { Textarea } from "@nervekit/workbench-ui/components/ui/textarea";

  type Props = {
    open?: boolean;
    command?: PinnedCommand | SandboxPinnedCommand;
    projectCwd?: string;
    saving?: boolean;
    onSave?: (input: CreatePinnedCommandRequest | UpdatePinnedCommandRequest) => void;
    onOpenChange?: (open: boolean) => void;
  };

  let {
    open = $bindable(false),
    command,
    projectCwd,
    saving = false,
    onSave,
    onOpenChange,
  }: Props = $props();

  let label = $state("");
  let commandText = $state("");
  let cwd = $state("");

  const title = $derived(command ? "Edit pinned task" : "Pin a command");
  const description = $derived(
    command
      ? "Update the label, command, and optional working directory for this pinned task."
      : "Create a reusable task shortcut.",
  );
  const submitLabel = $derived(command ? "Save pinned task" : "Pin task");
  const canSave = $derived(!saving && commandText.trim().length > 0);

  $effect(() => {
    if (!open) return;
    label = command?.label ?? "";
    commandText = command?.command ?? "";
    cwd = command?.cwd ?? "";
  });

  function submit() {
    if (!canSave) return;
    const nextLabel = label.trim();
    const nextCwd = cwd.trim();
    onSave?.({
      command: commandText.trim(),
      ...(nextLabel.length > 0 ? { label: nextLabel } : {}),
      ...(nextCwd.length > 0 ? { cwd: nextCwd } : {}),
    });
  }
</script>

<Dialog bind:open {title} {description} class="max-w-xl" {onOpenChange}>
  <div class="grid gap-4 p-4">
    <div class="grid gap-1.5">
      <Label for="pinned-command-label">Label</Label>
      <Input id="pinned-command-label" bind:value={label} placeholder="web-dev" disabled={saving} />
    </div>

    <div class="grid gap-1.5">
      <Label for="pinned-command-command">Command</Label>
      <Textarea
        id="pinned-command-command"
        bind:value={commandText}
        rows={4}
        placeholder="pnpm dev"
        class="font-mono text-xs"
        disabled={saving}
      />
      <p class="text-xs text-muted-foreground">This is the shell command run by the play button.</p>
    </div>

    <div class="grid gap-1.5">
      <Label for="pinned-command-cwd">Working directory</Label>
      <Input
        id="pinned-command-cwd"
        bind:value={cwd}
        placeholder={projectCwd ? `Default: ${projectCwd}` : "Default working directory"}
        class="font-mono text-xs"
        disabled={saving}
      />
      <p class="text-xs text-muted-foreground">Leave blank to use the default working directory.</p>
    </div>
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)} disabled={saving}>Cancel</Button>
    <Button onclick={submit} disabled={!canSave}>{saving ? "Saving…" : submitLabel}</Button>
  {/snippet}
</Dialog>
