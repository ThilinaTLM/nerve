<script lang="ts">
import type { AgentRecord } from "$lib/api";
import {
  agentSettingsSelection,
  agentSettingsPatch,
} from "./agent-settings-selection";
import type {
  AgentCompletion,
  EffectiveTurnConfiguration,
  UpdateAgentRequest,
} from "@nervekit/contracts/agents";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";

let {
  agent,
  latestCompletion,
  effectiveSnapshot,
  onSave,
  open = $bindable(false),
}: {
  agent: AgentRecord;
  latestCompletion?: AgentCompletion | null;
  effectiveSnapshot?: EffectiveTurnConfiguration | null;
  onSave: (patch: UpdateAgentRequest) => Promise<void>;
  open?: boolean;
} = $props();

let saving = $state(false);
let saveError = $state<string>();
let projectDir = $state("");
let roots = $state("");
let readonly = $state(false);
let systemPrompt = $state("");
let instructions = $state("");
let defaultTools = $state(true);
let tools = $state("");
let skills = $state("");
let defaultSkills = $state(true);
let initialDraft = $state<UpdateAgentRequest>({});
let draftAgentId = $state("");
function loadDraft() {
  projectDir = agent.projectDir;
  roots = agent.workspaceScope.roots.join("\n");
  readonly = Boolean(agent.workspaceScope.readonly || agent.readOnlyCeiling);
  systemPrompt = agent.systemPrompt ?? "";
  instructions = agent.instructions ?? "";
  defaultTools = agent.tools == null;
  tools = agent.tools?.join("\n") ?? "";
  skills = agent.skills?.join("\n") ?? "";
  defaultSkills = agent.skills == null;
  saveError = undefined;
  draftAgentId = agent.id;
  initialDraft = settingsFields();
}
let initializedOpen = false;
$effect(() => {
  if (open && initializedOpen && draftAgentId !== agent.id) open = false;
  if (open && !initializedOpen) loadDraft();
  initializedOpen = open;
});
function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
function settingsFields(): UpdateAgentRequest {
  return {
    projectDir: projectDir.trim(),
    workspaceScope: { roots: lines(roots), readonly },
    systemPrompt: systemPrompt.trim() || null,
    instructions,
    tools: agentSettingsSelection(defaultTools, tools),
    skills: agentSettingsSelection(defaultSkills, skills),
  };
}
async function save() {
  if (agent.id !== draftAgentId) {
    open = false;
    return;
  }
  saving = true;
  saveError = undefined;
  try {
    const patch = agentSettingsPatch(initialDraft, settingsFields());
    if (Object.keys(patch).length) await onSave(patch);
    open = false;
  } catch (caught) {
    saveError = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving = false;
  }
}
</script>

<DialogShell
  bind:open
  title="Agent settings"
  description="Changes are accepted now and take effect together at the next safe turn. Model, thinking, mode and permissions use the ordinary composer controls."
  size="wide"
>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-2">
      <Label for="agent-cwd">Working directory</Label><Input
        id="agent-cwd"
        bind:value={projectDir}
      />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="agent-roots">Workspace roots (one per line)</Label><Textarea
        id="agent-roots"
        bind:value={roots}
      />
    </div>
    <div class="flex items-center justify-between gap-2">
      <Label for="agent-readonly">Read-only workspace</Label><Switch
        id="agent-readonly"
        bind:checked={readonly}
        disabled={agent.readOnlyCeiling}
      />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="agent-system">System prompt</Label><Textarea
        id="agent-system"
        bind:value={systemPrompt}
      />
    </div>
    <div class="flex flex-col gap-2">
      <Label for="agent-instructions">Instructions</Label><Textarea
        id="agent-instructions"
        bind:value={instructions}
      />
    </div>
    <div class="flex items-center justify-between gap-2">
      <Label for="agent-default-tools">Use registered tools</Label><Switch
        id="agent-default-tools"
        bind:checked={defaultTools}
      />
    </div>
    {#if !defaultTools}<div class="flex flex-col gap-2">
        <Label for="agent-tools">Configured tools (one per line)</Label
        ><Textarea
          id="agent-tools"
          bind:value={tools}
          placeholder="Empty disables all tools"
        />
      </div>{/if}
    <div class="flex items-center justify-between gap-2">
      <Label for="agent-default-skills">Inherit resource skills</Label><Switch
        id="agent-default-skills"
        bind:checked={defaultSkills}
      />
    </div>
    {#if !defaultSkills}<div class="flex flex-col gap-2">
        <Label for="agent-skills"
          >Skills (one per line; empty disables all)</Label
        ><Textarea id="agent-skills" bind:value={skills} />
      </div>{/if}
    {#if effectiveSnapshot}
      <div
        class="flex flex-col gap-2"
        aria-label="Effective turn configuration"
      >
        <Label for="effective-agent-configuration"
          >Effective configuration {effectiveSnapshot.configurationRevision} · {effectiveSnapshot.configurationProvenance ===
          "resolved"
            ? "resolved turn"
            : "legacy accepted-only snapshot"}</Label
        >
        <Textarea
          id="effective-agent-configuration"
          readonly
          rows={6}
          value={JSON.stringify(effectiveSnapshot.configuration, null, 2)}
        />
      </div>
    {/if}
    {#if latestCompletion}<p
        class="text-xs text-muted-foreground"
        aria-label="Latest durable completion"
      >
        Last {latestCompletion.outcome} · {latestCompletion.runId} · attempt {latestCompletion.attemptId}
        · {latestCompletion.completedAt}
      </p>{/if}
    <p class="text-xs text-muted-foreground">
      Tool availability does not grant permission. Parent grants and read-only
      ceilings remain enforced.
    </p>
    {#if saveError}<p role="alert" class="text-xs text-destructive">
        {saveError}
      </p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" onclick={() => (open = false)} disabled={saving}
      >Cancel</Button
    >
    <Button
      onclick={save}
      disabled={saving || !projectDir.trim() || lines(roots).length === 0}
      >{saving ? "Saving…" : "Save agent settings"}</Button
    >
  {/snippet}
</DialogShell>
