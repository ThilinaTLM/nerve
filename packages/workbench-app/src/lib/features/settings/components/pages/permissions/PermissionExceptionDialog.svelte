<script lang="ts">
import type { PermissionException, ToolDescriptor } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/ui/dialog-shell";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import SelectField from "@nervekit/ui-kit/components/ui/select-field";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { createExceptionId } from "./permission-exception-presentation";

type Props = {
  open?: boolean;
  scopeLabel: string;
  tools: ToolDescriptor[];
  onSave?: (exception: PermissionException) => Promise<boolean>;
};

let { open = $bindable(false), scopeLabel, tools, onSave }: Props = $props();
let tool = $state<PermissionException["tool"]>("write");
let behavior = $state<"allow" | "deny">("allow");
let rule = $state("");
let saving = $state(false);
let error = $state<string>();

const selectedTool = $derived(
  tools.find((candidate) => candidate.name === tool),
);
const ruleKind = $derived(selectedTool?.permission.ruleKind ?? "tool");
const canAllow = $derived(selectedTool?.permission.durableAllow !== "never");
const toolItems = $derived(
  [...tools]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((descriptor) => ({
      value: descriptor.name,
      label: descriptor.name,
      detail: ruleDescription(descriptor.permission.ruleKind),
    })),
);

$effect(() => {
  if (!open) return;
  const preferred =
    tools.find((candidate) => candidate.name === "write") ?? tools[0];
  if (preferred) tool = preferred.name;
  behavior = preferred?.permission.durableAllow === "never" ? "deny" : "allow";
  rule = preferred?.permission.ruleKind === "tool" ? "*" : "";
  error = undefined;
});

$effect(() => {
  if (ruleKind === "tool") rule = "*";
  if (!canAllow && behavior === "allow") behavior = "deny";
});

function validate(): string | undefined {
  const value = rule.trim();
  if (!value) return "Enter a rule.";
  if (/\r|\n|\0/.test(value)) return "Rules must be a single line.";
  if (ruleKind === "path_glob") {
    if (
      value.includes("\\") ||
      value.startsWith("/") ||
      /^[A-Za-z]:/.test(value) ||
      value.split("/").includes("..")
    )
      return "Use a project-relative glob with forward slashes.";
  }
  if (ruleKind === "command_glob" && value === "*") {
    return "Use a focused command pattern instead of matching every command.";
  }
  if (ruleKind === "url_glob" && !value.includes("://")) {
    return "Include a scheme, such as https:// or *://.";
  }
  return undefined;
}

async function save(): Promise<void> {
  error = validate();
  if (error || !onSave || !selectedTool) return;
  saving = true;
  try {
    const exception: PermissionException = {
      id: createExceptionId(),
      tool: selectedTool.name,
      effect: behavior,
      rule: rule.trim(),
    };
    if (await onSave(exception)) open = false;
  } finally {
    saving = false;
  }
}

function onToolChange(value: string): void {
  tool = value as PermissionException["tool"];
  const descriptor = tools.find((candidate) => candidate.name === value);
  rule = descriptor?.permission.ruleKind === "tool" ? "*" : "";
  error = undefined;
}

function ruleDescription(
  kind: ToolDescriptor["permission"]["ruleKind"],
): string {
  if (kind === "path_glob") return "Project path glob";
  if (kind === "command_glob") return "Command glob";
  if (kind === "url_glob") return "URL glob";
  return "Whole tool";
}

function ruleLabel(): string {
  if (ruleKind === "path_glob") return "Project-relative path glob";
  if (ruleKind === "command_glob") return "Command pattern (glob)";
  if (ruleKind === "url_glob") return "URL pattern (glob)";
  return "Rule";
}

function rulePlaceholder(): string {
  if (ruleKind === "path_glob") return "packages/**";
  if (ruleKind === "command_glob") return "pnpm test*";
  if (ruleKind === "url_glob") return "https://*.example.com/**";
  return "*";
}
</script>

<Dialog
  bind:open
  size="sm"
  title={`Add ${scopeLabel.toLowerCase()} exception`}
  description="Choose one tool, whether matching calls are allowed or denied, and the rule they must match."
>
  <div class="grid gap-3">
    <div class="grid gap-1.5">
      <Label>Tool</Label>
      <SelectField
        items={toolItems}
        value={tool}
        onValueChange={onToolChange}
        ariaLabel="Exception tool"
      />
    </div>
    <div class="grid gap-1.5">
      <Label>Access</Label>
      <SelectField
        items={[
          {
            value: "allow",
            label: "Allow",
            detail: "Skip prompts in Supervised",
            disabled: !canAllow,
          },
          { value: "deny", label: "Deny", detail: "Block at every level" },
        ]}
        value={behavior}
        onValueChange={(value) => (behavior = value as typeof behavior)}
        ariaLabel="Exception access"
      />
    </div>
    <div class="grid gap-1.5">
      <Label for="permission-exception-rule">{ruleLabel()}</Label>
      <Input
        id="permission-exception-rule"
        size="xs"
        bind:value={rule}
        placeholder={rulePlaceholder()}
        disabled={ruleKind === "tool"}
        ariaLabel="Exception rule"
        class="font-mono"
      />
      <p class="text-xs text-muted-foreground">
        {ruleDescription(ruleKind)} for <span class="font-mono">{tool}</span>.
        {#if !canAllow}
          This tool can only be denied persistently.{/if}
      </p>
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
    <Button
      size="sm"
      disabled={saving || tools.length === 0}
      onclick={() => void save()}
    >
      {#if saving}<Spinner class="size-3.5" />Saving…{:else}Add exception{/if}
    </Button>
  {/snippet}
</Dialog>
