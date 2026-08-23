<script lang="ts">
import type { PermissionException } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { createExceptionId } from "./permission-exception-presentation";

type Props = {
  open?: boolean;
  onSave?: (exception: PermissionException) => Promise<boolean>;
};

let { open = $bindable(false), onSave }: Props = $props();
let kind = $state<"path" | "host">("path");
let behavior = $state<"allow" | "deny">("allow");
let access = $state<"read" | "write" | "read_write">("write");
let pattern = $state("");
let saving = $state(false);
let error = $state<string>();

$effect(() => {
  if (!open) return;
  kind = "path";
  behavior = "allow";
  access = "write";
  pattern = "";
  error = undefined;
});

function validate(): string | undefined {
  const value = pattern.trim();
  if (!value)
    return kind === "path" ? "Enter a path pattern." : "Enter a hostname.";
  if (kind === "path") {
    if (
      value.includes("\\") ||
      value.startsWith("/") ||
      /^[A-Za-z]:/.test(value) ||
      value.split("/").includes("..")
    ) {
      return "Use a project-relative glob with forward slashes.";
    }
    return undefined;
  }
  const host = value.startsWith("*.") ? value.slice(2) : value;
  return /^[a-z0-9.-]+$/i.test(host) && !host.includes("..")
    ? undefined
    : "Enter a hostname such as example.com or *.example.com.";
}

async function save(): Promise<void> {
  error = validate();
  if (error || !onSave) return;
  saving = true;
  const selector =
    kind === "path"
      ? {
          kind: "path_glob" as const,
          access: behavior === "allow" ? ("write" as const) : access,
          pattern: pattern.trim(),
        }
      : { kind: "web_host" as const, pattern: pattern.trim().toLowerCase() };
  const exception: PermissionException =
    behavior === "allow"
      ? {
          id: createExceptionId(),
          effect: behavior,
          risk: kind === "path" ? "workspace_write" : "network",
          selector,
        }
      : { id: createExceptionId(), effect: behavior, selector };
  try {
    if (await onSave(exception)) open = false;
  } finally {
    saving = false;
  }
}
</script>

<Dialog
  bind:open
  size="sm"
  title="Add permission exception"
  description="Create a focused exception to the standard permission baseline."
>
  <div class="grid gap-3">
    <div class="grid gap-1.5">
      <Label>Target</Label>
      <SelectField
        items={[
          { value: "path", label: "Files and folders" },
          { value: "host", label: "Website" },
        ]}
        value={kind}
        onValueChange={(value) => (kind = value as typeof kind)}
        ariaLabel="Exception target"
      />
    </div>
    <div class="grid gap-1.5">
      <Label>Behavior</Label>
      <SelectField
        items={[
          {
            value: "allow",
            label:
              kind === "path"
                ? "Allow writes without asking"
                : "Allow fetches without asking",
          },
          { value: "deny", label: "Block access" },
        ]}
        value={behavior}
        onValueChange={(value) => (behavior = value as typeof behavior)}
        ariaLabel="Exception behavior"
      />
    </div>
    {#if kind === "path" && behavior === "deny"}
      <div class="grid gap-1.5">
        <Label>Access</Label>
        <SelectField
          items={[
            { value: "read_write", label: "Read and write" },
            { value: "read", label: "Read only" },
            { value: "write", label: "Write only" },
          ]}
          value={access}
          onValueChange={(value) => (access = value as typeof access)}
          ariaLabel="File access"
        />
      </div>
    {/if}
    <div class="grid gap-1.5">
      <Label for="permission-exception-pattern"
        >{kind === "path" ? "Project-relative path glob" : "Hostname"}</Label
      >
      <Input
        id="permission-exception-pattern"
        size="xs"
        bind:value={pattern}
        placeholder={kind === "path" ? "secrets/**" : "*.example.com"}
        ariaLabel="Exception pattern"
      />
      <p class="text-xs text-muted-foreground">
        {kind === "path"
          ? "Examples: src/generated/** or **/.env*"
          : "Use an exact host or a leading wildcard for subdomains."}
      </p>
      {#if pattern.trim()}
        <p class="text-xs text-info">
          Preview: {kind === "path"
            ? `project/${pattern.trim()}`
            : `https://${pattern.trim()}`}
        </p>
      {/if}
      {#if error}<p class="text-xs text-destructive">{error}</p>{/if}
    </div>
  </div>
  {#snippet footer()}
    <Button
      size="sm"
      variant="ghost"
      disabled={saving}
      onclick={() => (open = false)}>Cancel</Button
    >
    <Button size="sm" disabled={saving} onclick={() => void save()}>
      {#if saving}<Spinner class="size-3.5" />Saving…{:else}Add exception{/if}
    </Button>
  {/snippet}
</Dialog>
