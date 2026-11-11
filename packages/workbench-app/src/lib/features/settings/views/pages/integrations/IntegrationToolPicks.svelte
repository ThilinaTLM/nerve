<!--
  Quick account picks for the tools that use one integration kind. Edits the
  same user-scope tool settings as the Tools page.
-->
<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import { leadSettingsOverridesSchema } from "@nervekit/contracts/agent-configuration";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import type { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { openSettingsPane } from "$lib/application/settings";
import { SettingsRow } from "$lib/presentation/settings";
import { toolSettingsMutation } from "../tools/tool-settings-mutation";
import {
  accountKind,
  toolRows,
  type AccountKind,
  type AccountOption,
  type ToolId,
  type ToolPayload,
} from "../tools/tool-settings";

type Props = {
  kind: AccountKind;
  accounts: AccountOption[];
  editor: ScopedAgentState;
};
let { kind, accounts, editor }: Props = $props();

const tools = $derived(toolRows.filter((row) => accountKind(row.id) === kind));
const items = $derived(
  accounts.map((a) => ({ value: a.id, label: a.name, detail: a.detail })),
);
const locked = $derived(editor.saving || !editor.resolution);

function payload(id: ToolId): ToolPayload {
  return editor.resolution?.settings.tools?.[id] ?? {};
}
function hasAccount(id: ToolId): boolean {
  const chosen = payload(id).profileId;
  return accounts.some((a) => a.id === chosen);
}
function pick(id: ToolId, profileId: string): void {
  if (!profileId || profileId === payload(id).profileId) return;
  try {
    const mutation = toolSettingsMutation(
      id,
      { ...payload(id), profileId },
      editor.overrides,
    );
    void editor.save(mutation.changes, mutation.resets);
  } catch {
    editor.error = "Couldn’t save the account choice. Try again in Tools.";
  }
}
function toggle(id: ToolId, enabled: boolean): void {
  void editor.save(
    leadSettingsOverridesSchema.parse({ tools: { [id]: { enabled } } }),
  );
}
</script>

{#if accounts.length > 0 && editor.resolution}
  <div class="-mx-3 grid gap-1 border-t px-3 pt-2">
    <p class="text-caption text-muted-foreground">
      Adding an account doesn’t switch tools to it. Choose the account each tool
      uses here or in
      <button
        type="button"
        class="inline-flex items-center gap-0.5 rounded-sm text-primary hover:bg-hover"
        onclick={() => void openSettingsPane("tools")}
        >Tools<ArrowRight class="size-3" aria-hidden="true" /></button
      >
    </p>
    {#each tools as tool (tool.id)}
      {@const value = payload(tool.id)}
      <SettingsRow
        label={tool.label}
        description={value.enabled
          ? "On"
          : hasAccount(tool.id)
            ? "Off"
            : "Off · choose an account to turn it on"}
      >
        {#snippet control()}
          <div class="flex items-center gap-2">
            <SelectField
              class="w-48"
              {items}
              value={hasAccount(tool.id) ? (value.profileId ?? "") : ""}
              placeholder="Choose account"
              disabled={locked}
              ariaLabel={`${tool.label} account`}
              onValueChange={(next) => pick(tool.id, next)}
            />
            <Switch
              checked={value.enabled === true}
              disabled={locked || (!value.enabled && !hasAccount(tool.id))}
              aria-label={`Enable ${tool.label}`}
              onCheckedChange={(next) => toggle(tool.id, next)}
            />
          </div>
        {/snippet}
      </SettingsRow>
    {/each}
    {#if editor.error}
      <p class="text-caption text-destructive">{editor.error}</p>
    {/if}
  </div>
{/if}
